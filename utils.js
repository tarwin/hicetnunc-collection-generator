const axios = require('axios');
const { exec } = require("child_process");
const sharp = require('sharp');
const fs = require('fs');

const config = require('./config.json')
const thumbnailPath = `${config.distPath}/${config.thumbnail.path}`

const createThumbnails = async (largeImageFilename, objectId) => {
  for (let size of config.thumbnail.image.sizes) {
    for (let format of config.thumbnail.image.formats) {
      await resizeImageToMaxWidth(
        size,
        `${config.largeImagePath}/${largeImageFilename}`,
        `${thumbnailPath}/${objectId}-${size}.${format}`,
      )
    }
  }
}

const createLargeImage = async (filename, objectId) => {
  await resizeImageToMaxWidth(
    1024,
    `${config.downloadPath}/${filename}`,
    `${config.largeImagePath}/${objectId}.png`
  )
}

const resizeImageToMaxWidth = async (width, inFile, outFile) => {
  console.log('resizeImageToMaxWidth', inFile, outFile)
  const meta = await getImageMetadata(inFile)
  const dims = getMaxDimensions(meta.width, meta.height, width)
  let options = {}
  // if it's animated ie GIF, get an image from the middle
  if (meta.pages) {
    options.pages = 1
    options.page = Math.floor(meta.pages / 2)
  }
  return await sharp(inFile, options)
    .resize(dims.width, dims.height)
    .toFile(outFile)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// gives you dimensions maximized to a measure
const getMaxDimensions = (width, height, maxWidth) => {
  let w = width
  let h = height
  if (width > maxWidth) {
    w = maxWidth
    h = height * (maxWidth / width)
  }
  return {
    width: Math.round(w),
    height: Math.round(h)
  }
}

const niceExec = async (cmd) => {
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

module.exports = {
  createThumbnails,
  createLargeImage,
  resizeImageToMaxWidth,
  sleep,
  getMaxDimensions,
  niceExec,
  downloadFile,
  getImageMetadata
}