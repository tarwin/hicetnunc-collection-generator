const axios = require('axios');
const { exec } = require("child_process");
const sharp = require('sharp');
const fs = require('fs');
const fetch = require('node-fetch')

const getArgs = function() {
  return process.argv.slice(2)
}

let config = require('./config.json')
if (getArgs()[0]) {
  config = require(`./${getArgs()[0]}config.json`)
}

const thumbnailPath = `${config.distPath}/${config.thumbnail.path}`
const maxVideoLength = config.thumbnail.video.maxLengthSeconds

const niceExec = async (cmd) => {
  console.log('\x1b[36m%s\x1b[0m', cmd)
  return new Promise((resolve, reject) => {
    exec(cmd, function(error, stdout, stderr) {
      if (error) {
        console.log(`error: ${error.message}`);
        return reject(error)
      }
      // if (stderr) {
      //   console.log(`stderr: ${stderr}`);
      //   return reject(stderr)
      // }
      resolve(stdout)
    });
  })
}

const getMaxRate = (size) => {
  let maxRate = '-crf 23 -maxrate 1M'
  if (size < 600) maxRate = '-crf 23 -maxrate 700k -bufsize 1M'
  if (size < 300) maxRate = '-crf 23 -maxrate 400k -bufsize 1M'
  return maxRate
}

const getVideoOrGifDuration = async (file, inSeconds = false) => {
  const info = await niceExec(`ffprobe ${file} 2>&1`)
  const durationMatch = info.match(/Duration: ([0-9][0-9]):([0-9][0-9]):([0-9][0-9]\.[0-9]+)/i)
  if (!durationMatch) {
    return -1
  }
  if (inSeconds) {
    return parseFloat(durationMatch[3]) + parseInt(durationMatch[2]) * 60 + parseInt(durationMatch[1]) * 3600
  } else {
    return `${durationMatch[1]}:${durationMatch[2]}:${durationMatch[3]}`
  }
}

const getVideoOrGifFrames = async (file) => {
  const info = await niceExec(`ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 ${file} 2>&1`)
  const frames = parseInt(info)
  return frames
}

const createThumbnails = async (largeImageFilename, objectId) => {
  const imageConf = config.thumbnail.image
  const largeMeta = await getImageMetadata(`${config.largeImagePath}/${largeImageFilename}`)
  const meta = []
  for (let format of imageConf.formats) {
    for (let size of imageConf.sizes) {
      const toFilename = `${thumbnailPath}/${objectId}-${size}.${format.type}`
      const info = await resizeImageToMaxWidth(
        largeMeta,
        size,
        `${config.largeImagePath}/${largeImageFilename}`,
        toFilename,
        false,
        format.type,
        format.options || {}
      )
      const fileSize = fs.statSync(toFilename).size
      meta.push({
        width: info.width,
        height: info.height,
        fileSize,
        file: `${objectId}-${size}.${format.type}`,
        frames: info.pages || 1,
        mime: `image/${format.type}`
      })
    }
  }
  return meta
}

const createAudioThumbnail = async (filename, objectId) => {
  const imageConf = config.thumbnail.image
  const meta = []
  for (let format of imageConf.formats) {
    for (let size of imageConf.sizes) {
      const toFilename = `${thumbnailPath}/${objectId}-${size}.${format.type}`
      const info = await resizeImageToMaxWidth(
        { width: 1024, height: 512 },
        size,
        `${config.largeImagePath}/${filename}`,
        toFilename,
        true,
        format.type,
      )
      const fileSize = fs.statSync(toFilename).size
      meta.push({
        width: info.width,
        height: info.height,
        fileSize,
        file: `${objectId}-${size}.${format.type}`,
        frames: info.pages || 1,
        mime: `image/${format.type}`
      })
    }
  }
  return meta
}

const createGifThumbnails = async (largeImageFilename, objectId) => {
  const imageConf = config.thumbnail.image
  const largeMeta = await getImageMetadata(`${config.largeImagePath}/${largeImageFilename}`)
  const meta = []
  for (let size of imageConf.sizes) {
    const toFilename = `${thumbnailPath}/${objectId}-${size}.gif`
    const dims = getMaxDimensions(largeMeta.width, largeMeta.height, size)
    // make sure is divisible by 2 for video
    dims.width = dims.width - dims.width % 2
    dims.height = dims.height - dims.height % 2
    // -y force overwrite
    const cmd = `ffmpeg -y -i ${config.largeImagePath}/${largeImageFilename} -filter_complex "[0:v] scale=${dims.width}:${dims.height} : flags=lanczos, split [a][b]; [a] palettegen=reserve_transparent=on:transparency_color=ffffff [p]; [b][p] paletteuse" ${toFilename}`
    await niceExec(cmd)
    const fileSize = fs.statSync(toFilename).size
    meta.push({
      width: dims.width,
      height: dims.height,
      fileSize,
      file: `${objectId}-${size}.gif`,
      mime: `image/gif`
    })
  }
  return meta
}

const createVideoThumbnailsFromGif = async (largeImageFilename, objectId) => {
  const largeMeta = await getImageMetadata(`${config.largeImagePath}/${largeImageFilename}`)
  const meta = []
  for (let size of config.thumbnail.video.sizes) {
    const toFilename = `${thumbnailPath}/${objectId}-${size}.mp4`
    const dims = getMaxDimensions(largeMeta.width, largeMeta.height, size)
    // make sure is divisible by 2 for video
    dims.width = dims.width - dims.width % 2
    dims.height = dims.height - dims.height % 2
    let maxRate = getMaxRate(size)
    await niceExec(`ffmpeg -y -t ${maxVideoLength} -i ${config.largeImagePath}/${largeImageFilename} -movflags faststart -an -pix_fmt yuv420p -vf "fps=12,scale=${dims.width}:${dims.height}:flags=lanczos" ${maxRate} ${toFilename}`)
    const fileSize = fs.statSync(toFilename).size
    meta.push({
      width: dims.width,
      height: dims.height,
      fileSize,
      file: `${objectId}-${size}.mp4`,
      mime: `video/mp4`
    })
  }
  return meta
}

const createVideoThumbnailsFromVideo = async (originalVideo, largeImageFilename, objectId) => {
  const meta = []
  const frames = await getVideoOrGifFrames(originalVideo)
  // don't creat thumbs for video of 1 frame
  if (frames < 2) {
    return meta
  }
  const largeMeta = await getImageMetadata(`${largeImageFilename}`)
  for (let size of config.thumbnail.video.sizes) {
    const toFilename = `${thumbnailPath}/${objectId}-${size}.mp4`
    const dims = getMaxDimensions(largeMeta.width, largeMeta.height, size)
    // make sure is divisible by 2 for video
    dims.width = dims.width - dims.width % 2
    dims.height = dims.height - dims.height % 2
    let maxRate = getMaxRate(size)
    const cmd = `ffmpeg -y -t ${maxVideoLength} -i ${originalVideo} -movflags faststart -an -pix_fmt yuv420p -vf "fps=12,scale=${dims.width}:${dims.height}:flags=lanczos" ${maxRate} ${toFilename}`
    await niceExec(cmd)
    const fileSize = fs.statSync(toFilename).size
    meta.push({
      width: dims.width,
      height: dims.height,
      fileSize,
      file: `${objectId}-${size}.mp4`,
      mime: `video/mp4`
    })
  }
  return meta
}

const createLargeImage = async (filename, objectId) => {
  // don't need to recreate
  if (fs.existsSync(`${config.largeImagePath}/${objectId}.png`)) {
    return
  }
  await resizeImageToMaxWidth(
    meta,
    1024,
    `${config.downloadPath}/${filename}`,
    `${config.largeImagePath}/${objectId}.png`,
    false,
    'png'
  )
}

const createLargeFromBmp = async (bmpFilename, objectId) => {
  const toFilename = `${config.largeImagePath}/${objectId}.png`
  await niceExec(`ffmpeg -y -i ${bmpFilename} ${toFilename}`)
}

const createLargeFromVideo = async (filename, tokenId) => {
  // extract image from middle of video
  const duration = await getVideoOrGifDuration(`${config.downloadPath}/${filename}`, true)
  if (duration > 0) {
    let midpoint = duration / 2
    if (midpoint < 1) {
      midpoint = 0
    }
    let convertCommand = `ffmpeg -y -i ${config.downloadPath}/${filename} -vcodec mjpeg -vframes 1 -an -f rawvideo -vf scale=iw*sar:ih `
    convertCommand += ` -ss ${midpoint}`
    convertCommand += ` ${config.largeImagePath}/${tokenId}.png`
    await niceExec(convertCommand)
  } else {
    console.log('Failed creating large for video', tokenId)
  }
}

const resizeImageToMaxWidth = async (meta, width, inFile, outFile, forceWidth = false, format = 'jpg', fileOptionsParam = {}) => {
  console.log('resizeImageToMaxWidth', inFile, outFile)
  const dims = getMaxDimensions(meta.width, meta.height, width, forceWidth)
  let options = {}
  // if it's animated ie GIF, get an image from the middle
  if (meta.pages) {
    options.pages = 1
    options.page = Math.floor(meta.pages / 2)
  }
  const fileOptions = fileOptionsParam || {}
  return await sharp(inFile, options)
    .resize(dims.width, dims.height)
    .toFormat(format, fileOptions)
    .toFile(outFile)
}

const getVideoWidthHeight = async (file) => {
  const info = await niceExec(`ffprobe -v error -show_entries stream=width,height ${file} 2>&1`)
  const match = info.match(/width=([0-9]+)\s*\nheight=([0-9]+)/i)
  if (!match) {
    return { width: -1, height: -1 }
  }
  return { width: match[1], height: match[2] }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// gives you dimensions maximized to a measure
const getMaxDimensions = (width, height, maxWidth, forceWidth = false) => {
  let w = width
  let h = height
  if (width > maxWidth) {
    w = maxWidth
    h = height * (maxWidth / width)
  }
  if (forceWidth && width < maxWidth) {
    w = maxWidth
    h = maxWidth * (width / height)
  }
  return {
    width: Math.round(w),
    height: Math.round(h)
  }
}

const downloadFile = (url, imagePath) => {
  return axios({
    url,
    responseType: 'stream',
    headers: {
      Range: `bytes=0-`
    }
  }).then(response => {
    return new Promise((resolve, reject) => {
      response.data
        .pipe(fs.createWriteStream(imagePath))
        .on('finish', () => resolve())
        .on('error', e => reject(e));
    })
  })
}

// gets information about an image
// format (ie png), width, height, pages (if exists is animated, # of frames)
const getImageMetadata = async (file) => {
  return new Promise((resolve, reject) => {
    sharp(file)
    .metadata()
    .then(info => {
      resolve(info)
    })
    .catch((e) => {
      reject(e)
    })
  })
}

const getDisplayUri = async (obj) => {
  if (obj && obj.token_info && obj.token_info.displayUri) {
    return obj.token_info.displayUri
  }
  if (obj && obj.extras && obj.extras['@@empty']) {
    try {
      const infoUri = obj.extras['@@empty'].substr(7)
      const displayUrl = config.cloudFlareUrl + infoUri
      const res = await fetch(displayUrl)
      const json = (await res.json())
      return json.displayUri
    } catch {
      return null
    }
  }
  return null
}

module.exports = {
  createThumbnails,
  createLargeImage,
  resizeImageToMaxWidth,
  sleep,
  getMaxDimensions,
  niceExec,
  downloadFile,
  getImageMetadata,
  createAudioThumbnail,
  getArgs,
  createGifThumbnails,
  createVideoThumbnailsFromGif,
  createVideoThumbnailsFromVideo,
  getVideoOrGifDuration,
  getVideoWidthHeight,
  getDisplayUri,
  createLargeFromBmp,
  createLargeFromVideo
}