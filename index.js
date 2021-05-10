const {
  createThumbnails,
  createLargeImage,
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
  createLargeFromBmp
} = require('./utils')

// ----------------------
// config
let config = require('./config.json')
if (getArgs()[0]) {
  config = require(`./${getArgs()[0]}config.json`)
}

let fillMode = false
if (config.fillMode) {
  fillMode = true
}

const browserWidth = config.puppetSize;
const browserHeight = config.puppetSize;

// ------------------------------------------------------------------
// libs
const fs = require('fs');
const puppeteer = require('puppeteer');
const ipfsClient = require('ipfs-http-client')
const fetch = require('node-fetch')
var PDFImage = require("pdf-image").PDFImage;
const audioToSvgWaveform = require('./lib/audio-to-svg-waveform')
// const PuppeteerVideoRecorder = require('puppeteer-video-recorder');

// ------------------------------------------------------------------
// mime type setup
const converters = {
  'image/gif': { use: 'sharp', ext: 'gif' },
  'image/png': { use: 'sharp', ext: 'png' },
  'image/jpeg': { use: 'sharp', ext: 'jpg' },
  'image/webp': { use: 'sharp', ext: 'webp' },
  'image/tiff': { use: 'sharp', ext: 'tif' },
  'image/bmp': { use: 'sharp', ext: 'bmp' },
  
  'video/quicktime': { use: 'ffmpeg', ext: 'mov' },
  'video/mp4': { use: 'ffmpeg', ext: 'mp4' },
  'video/webm': { use: 'ffmpeg', ext: 'webm' },
  'video/ogg': { use: 'ffmpeg', ext: 'ogg' },

  'application/x-directory': { use: 'html', ext: 'html' },

  'model/gltf+json': { use: 'gltf', ext: 'gltf' },
  'model/gltf-binary': { use: 'gltf', ext: 'gltf' },

  'image/svg+xml': { use: 'svg', ext: 'svg' },

  'audio/mpeg': { use: 'audio', ext: 'm4a' },
  'audio/ogg': { use: 'audio', ext: 'ogg' },

  'application/pdf': { use: 'pdf', ext: 'pdf' },
}

// ------------------------------------------------------------------
// utility functions

let errorLog = './error.log'

// create directories if they don't exist
const thumbnailPath = `${config.distPath}/${config.thumbnail.path}`
if (!fs.existsSync(config.downloadPath)) fs.mkdirSync(config.downloadPath)
if (!fs.existsSync(config.largeImagePath)) fs.mkdirSync(config.largeImagePath)
if (!fs.existsSync(config.distPath)) fs.mkdirSync(config.distPath)
if (!fs.existsSync(thumbnailPath)) fs.mkdirSync(thumbnailPath)
if (fillMode) {
  errorLog = `${config.fillMode.objPath}/error.log`
  if (!fs.existsSync(config.fillMode.objPath)) fs.mkdirSync(config.fillMode.objPath)
  if (fs.existsSync(errorLog)) {
    fs.unlinkSync(errorLog)
  }
  fs.writeFileSync(errorLog, '')
}

function addWarning(str) {
  console.log('\x1b[33m%s\x1b[0m', `WARNING: ${str}`)
  fs.appendFileSync(errorLog, `\n${str}`)
}

const getNiceDataObjects = async(objects) => {
  const out = []
  for (let obj of objects) {
    const cidv1 = new ipfsClient.CID(obj.token_info.artifactUri.substr(7)).toV1()
    const subomain = cidv1.toString()
    out.push({
      id: obj.token_id,
      name: obj.token_info.name,
      description: obj.token_info.description,
      tags: obj.token_info.tags,
      creatorAddress: obj.token_info.creators[0],
      mime: obj.token_info.formats[0].mimeType,
      artifactUri: obj.token_info.artifactUri,
      cid: subomain,
      formats: obj.formats
    })
  }
  return out
}

const getNiceData = async(collected, created) => {
  const niceData = {
    config: {
      thumbnail: config.thumbnail
    },
    owner: {
      address: config.ownerAddress
    },
    collectedObjects: await getNiceDataObjects(collected),
    createdObjects: await getNiceDataObjects(created),
  }

  return niceData
}

// ------------------------------------------------------------------
// main func / loop
const main = async () => {

  let objects = []
  if (!fillMode) {
    const res = await fetch(`https://51rknuvw76.execute-api.us-east-1.amazonaws.com/dev/tz?tz=${config.ownerAddress}`)
    objects = (await res.json()).result
  } else {
    objects = require(config.fillMode.data)
    if (config.fillMode.limit) {
      let start = config.fillMode.offset || 0
      let end = start + config.fillMode.limit
      if (end > objects.length - 1) {
        end = objects.length - 1
      }
      objects = objects.slice(start, end)
    }
    console.log(`Working to fill ${objects.length} OBJKTs.`)
  }

  if (config.ignoreObjects && config.ignoreObjects.length) {
    objects = objects.filter(obj => {
      // filter out unwanted
      return !config.ignoreObjects.includes(obj.token_id)
    })
  }
  if (config.onlyObjects && config.onlyObjects.length) {
    objects = objects.filter(obj => {
      // filter out unwanted
      return config.onlyObjects.includes(obj.token_id)
    })
  }

  objects = objects.sort((a, b) => {
    return a.token_id - b.token_id
  })

  // items you own, others are ones you created
  let collected
  let created
  if (!fillMode) {
    collected = objects.filter(d => !d.token_info.creators.includes(config.ownerAddress))
    created = objects.filter(d => d.token_info.creators.includes(config.ownerAddress))
    console.log('COLLECTED: ', collected.length)
    console.log('CREATED: ', created.length)
  }

  // start puppeteer
  const browser = await puppeteer.launch({
      defaultViewport: {
          width: browserWidth,
          height: browserHeight,
          isLandscape: true
      },
      dumpio: true, // print output to console in case something is going wrong
      headless: false, // has to be non-headless to get webgl working properly?
      args: [
        '--hide-scrollbars',
        '--mute-audio'
      ],
  });

  const objThumbnails = {}
  const objOriginal = {}

  // go through each object
  for (let obj of objects) {
    const tokenId = obj.token_id
    let mime
    let ipfsUri

    if (fillMode) {
      if (!obj.formats || !obj.formats[0] || !obj.formats[0].mimeType) {
        console.warn(`No formats for ${tokenId}.`)
        continue
      }
      mime = obj.formats[0].mimeType
      ipfsUri = obj.artifact_uri.substr(7)
    } else {
      mime = obj.token_info.formats[0].mimeType
      ipfsUri = obj.token_info.artifactUri.substr(7)
    }

    const converter = converters[mime]

    if (!converter) {
      addWarning(`No converter for ${tokenId} - MIME: ${mime}`)
      continue
    }

    // could use another IPFS HTTP gateway?
    const url = config.cloudFlareUrl + ipfsUri

    const canDeleteDownload = []
    const canDeleteLarge = []

    // write actual
    const filename = `${tokenId}.${converter.ext}`
    console.log(`\n====================\nProcessing ${filename}`)

    // if we don't have the original file download it
    if (converter.use !== 'html') {
      if (!fs.existsSync(`${config.downloadPath}/${filename}`)) {
        console.log(`Downloading ${tokenId}`)
        // for some reason I couldn't simply use `fetch` to download from IPFS
        // something to do with HTTP Partial Content and me not wanting to handle it
        if (converter.use === 'ffmpeg') {
          // so yeah, I use stolen python code instead ...
          await niceExec(`python3 download.py ${ipfsUri} ${config.downloadPath} ${filename}`)
        } else {
          await downloadFile(url, `${config.downloadPath}/${filename}`)
        }
        canDeleteDownload.push(`${config.downloadPath}/${filename}`)
        console.log(`Written "${filename}"`)
      } else {
        console.log(`Exists "${filename}"`)
      }
    }

    // if we actually have a converter for this mime type
    // we should have one for each, but if more are added maybe not?
    if (converter) {

      // skip for existing thumbnails
      if (fs.existsSync(`${thumbnailPath}/${tokenId}-${config.thumbnail.image.sizes[0]}.${config.thumbnail.image.formats[0].type}`)) {
        continue
      }

      if (converter.use === 'pdf') {
        if (!fs.existsSync(`${config.largeImagePath}/${tokenId}.png`)) {
          const pdfImage = new PDFImage(`${config.downloadPath}/${filename}`)
          await pdfImage.convertPage(0) // saves in downloads / tokenId-0.png
          fs.copyFileSync(`${config.downloadPath}/${tokenId}-0.png`, `${config.largeImagePath}/${tokenId}.png`)
          
          canDeleteDownload.push(`${config.downloadPath}/${tokenId}-0.png`)
          canDeleteLarge.push(`${config.largeImagePath}/${tokenId}.png`)
        }
        objThumbnails[tokenId] = await createThumbnails(`${tokenId}.png`, tokenId)

      } else if (converter.use === 'audio') {
        if (!fs.existsSync(`./${config.largeImagePath}/${tokenId}.svg`)) {
          await audioToSvgWaveform(`${config.downloadPath}/${filename}`, `./${config.largeImagePath}/${tokenId}.svg`)
        }
        fs.copyFileSync(`./${config.largeImagePath}/${tokenId}.svg`, `./${thumbnailPath}/${tokenId}.svg`)
        objThumbnails[tokenId] = await createAudioThumbnail(`${tokenId}.svg`, tokenId)
        const duration = await getVideoOrGifDuration(`${config.downloadPath}/${filename}`)
        objOriginal[tokenId] = { duration }

        canDeleteLarge.push(`${config.largeImagePath}/${tokenId}.svg`)
      } else if (converter.use === 'sharp') {
        if (converter.ext === 'bmp') {
          // bmps are annoying! sharp doesn't do 'em
          await createLargeFromBmp(`${config.downloadPath}/${filename}`, tokenId)
          
          objThumbnails[tokenId]= await createThumbnails(`${tokenId}.png`, tokenId)

          const preMata = await getImageMetadata(`${config.largeImagePath}/${tokenId}.png`)
          objOriginal[tokenId] = {
            width: preMata.width,
            height: preMata.height
          }

          canDeleteLarge.push(`${config.largeImagePath}/${filename}`)
        } else {
          if (!fs.existsSync(`${config.largeImagePath}/${filename}`)) {
            fs.copyFileSync(`${config.downloadPath}/${filename}`, `${config.largeImagePath}/${filename}`)
          }
          const preMata = await getImageMetadata(`${config.largeImagePath}/${filename}`)
          if (preMata.format !== 'gif') {
            objThumbnails[tokenId]= await createThumbnails(filename, tokenId)
          } else {
            // single frame so just make thumbs as expected
            if (preMata.pages === 1) {
              objThumbnails[tokenId]= await createThumbnails(filename, tokenId)
            } else {
              // if smaller than X use GIF
              if (fs.statSync(`${config.largeImagePath}/${filename}`).size <= config.thumbnail.maxGifSizeKb * 1000) {
                objThumbnails[tokenId] = await createGifThumbnails(filename, tokenId)
              } else {
                // else use MP4
                objThumbnails[tokenId] = await createVideoThumbnailsFromGif(filename, tokenId)
                // and still images
                objThumbnails[tokenId] = objThumbnails[tokenId].concat(await createThumbnails(filename, tokenId))
              }
              // get duration of video/gif thumbs
              const duration = await getVideoOrGifDuration(`${thumbnailPath}/${objThumbnails[tokenId][0].file}`)
              objThumbnails[tokenId].forEach(o => o.duration = duration)

              // for non fill mode we also want general thumbs
              if (!fillMode) {
                // general thumbnails
                objThumbnails[tokenId] = objThumbnails[tokenId].concat(await createThumbnails(filename, tokenId))
              }
            }
          }

          objOriginal[tokenId] = {
            width: preMata.width,
            height: preMata.height
          }

          canDeleteLarge.push(`${config.largeImagePath}/${filename}`)
        }
      } else if (converter.use === 'ffmpeg') {
        if (!fs.existsSync(`${config.largeImagePath}/${tokenId}.png`)) {
          // extract image from middle of video
          const duration = await getVideoOrGifDuration(`${config.downloadPath}/${filename}`, true)
          if (duration > 0) {
            let midpoint = duration / 2
            let convertCommand = `ffmpeg -y -i ${config.downloadPath}/${filename} -vcodec mjpeg -vframes 1 -an -f rawvideo -vf scale=iw*sar:ih `
            convertCommand += ` -ss ${midpoint}`
            convertCommand += ` ${config.largeImagePath}/${tokenId}.png`
            await niceExec(convertCommand)
          } else {
            console.log('Failed creating large for video', tokenId)
          }
        }
        // create video thumbs
        objThumbnails[tokenId] = await createVideoThumbnailsFromVideo(`${config.downloadPath}/${filename}`, `${config.largeImagePath}/${tokenId}.png`, tokenId)
        // get duration of video thumb
        const duration = await getVideoOrGifDuration(`${thumbnailPath}/${objThumbnails[tokenId][0].file}`)
        objThumbnails[tokenId].forEach(o => o.duration = duration)

        // create image thumbs
        objThumbnails[tokenId] = objThumbnails[tokenId].concat(await createThumbnails(`${tokenId}.png`, tokenId))

        const widthHeight = await getVideoWidthHeight(`${config.downloadPath}/${filename}`)
        objOriginal[tokenId] = {
          width: widthHeight.width,
          height: widthHeight.height,
          duration
        }

        canDeleteLarge.push(`${config.largeImagePath}/${tokenId}.png`)
      } else if (converter.use === 'html') {
        // has thumb
        const displayUri = await getDisplayUri(obj)
        if (displayUri) {
          const displayIpfsUri = displayUri.substr(7)
          const displayUrl = config.cloudFlareUrl + displayIpfsUri
          await downloadFile(displayUrl, `${config.downloadPath}/${tokenId}_display`)
          // rename to correct ext
          const meta = await getImageMetadata(`${config.downloadPath}/${tokenId}_display`)
          fs.renameSync(`${config.downloadPath}/${tokenId}_display`, `${config.downloadPath}/${tokenId}.${meta.format}`)
          fs.copyFileSync(`${config.downloadPath}/${tokenId}.${meta.format}`, `${config.largeImagePath}/${tokenId}.${meta.format}`)
          // create thumbnail
          objThumbnails[tokenId] = await createThumbnails(`${tokenId}.${meta.format}`, tokenId)

          canDeleteLarge.push(`${config.largeImagePath}/${tokenId}.${meta.format}`)
        } else {
          // could use puppeteer to make a thumb but these SHOULD have them defined
          addWarning(`Missing "displayUri" for ${tokenId}`)
        }
      } else if (converter.use === 'gltf') {
        // don't think GL requires a displayUri so we're just going to have
        // to make thumbs ourselves.
        if (!fs.existsSync(`${config.largeImagePath}/${tokenId}.png`)) {
          const url = `http://localhost:5000/${config.downloadPath}/${tokenId}.gltf`

          const html = `<html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <script type="module" src="https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js"></script>
              <style>
                html, body {
                  width: 100%;
                  height: 100%;
                  padding: 0;
                  margin: 0;
                }
                #viewer {
                  width: ${browserWidth}px;
                  height: ${browserHeight}px;
                  --poster-color: transparent;
                  --progress-bar-color: transparent;
                }
              </style>
            </head>
            <body>
              <model-viewer
                id="viewer"
                src="${url}"
                auto-rotate
                auto-rotate-delay="1"
                interaction-prompt="none"
                rotation-per-second="0deg"
              ></model-viewer>
              <script>
                const modelViewerParameters = document.querySelector('model-viewer#viewer');
                // once the model is visible
                modelViewerParameters.addEventListener('model-visibility', (e) => {
                  // wait a second in case the browser hasn't actually rendered it yet
                  setTimeout(() => {
                    // add a div#done which puppeteer will wait for before taking a screenshot
                    const d = document.createElement('div')
                    d.setAttribute('id', 'done')
                    document.body.appendChild(d)
                  }, 1000)
                });
              </script>
            </body>
          </html>`
          
          let base64Html = Buffer.from(html).toString('base64');

          const browserPage = await browser.newPage();
          await browserPage.goto(`data:text/html;base64,${base64Html}`);
          console.log('Waiting for visibility')
          await browserPage.waitForSelector('#done')
          console.log('Visible')
          await browserPage.screenshot({path: `${config.largeImagePath}/${tokenId}.png`, omitBackground: true});
          await browserPage.close()
        }

        objThumbnails[tokenId] = await createThumbnails(`${tokenId}.png`, tokenId)

        canDeleteLarge.push(`${config.largeImagePath}/${tokenId}.png`)
      } else if (converter.use === 'svg') {
        // has thumb
        const displayUri = await getDisplayUri(obj)
        if (displayUri) {
          const displayIpfsUri = displayUri.substr(7)
          const displayUrl = config.cloudFlareUrl + displayIpfsUri
          await downloadFile(displayUrl, `${config.downloadPath}/${tokenId}_display`)
          // rename to correct ext
          const meta = await getImageMetadata(`${config.downloadPath}/${tokenId}_display`)
          fs.renameSync(`${config.downloadPath}/${tokenId}_display`, `${config.downloadPath}/${tokenId}.${meta.format}`)
          await createLargeImage(`${tokenId}.${meta.format}`, tokenId)

          canDeleteLarge.push(`${config.largeImagePath}/${tokenId}.${meta.format}`)
        } else if (!fs.existsSync(`${config.largeImagePath}/${tokenId}.png`)) {
          const url = `http://localhost:5000/${config.downloadPath.substr(2)}/${tokenId}.svg`
          const meta = await getImageMetadata(`./${config.downloadPath}/${tokenId}.svg`)
          const dims = getMaxDimensions(meta.width, meta.height, 2000)

          const html = `<html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <style>
                html, body {
                  width: 100%;
                  height: 100%;
                  padding: 0;
                  margin: 0;
                }
              </style>
            </head>
            <body>
              <script>
                const myWindow = window.open('${url}', 'svg', 'width=${dims.width}, height=${dims.height}');
                // I open a new window to make sure we have the correct dimensions
                myWindow.resizeTo(${dims.width}, ${dims.height})
                myWindow.focus()
                setTimeout(() => {
                  const d = document.createElement('div')
                  d.setAttribute('id', 'done')
                  document.body.appendChild(d)
                }, 1000)
              </script>
            </body>
          </html>`
        
          let base64Html = Buffer.from(html).toString('base64');

          const browserPage = await browser.newPage();
          await browserPage.goto(`data:text/html;base64,${base64Html}`);
          console.log('Waiting for visibility')
          await browserPage.waitForSelector('#done')
          console.log('Visible')

          // because we opened a new window we have to look through the list of windows
          // and find the one we just opened
          // must be a nicer way to do this?
          let chosenPage = null
          for (let page of await browser.pages()) {
            if (await page.url() === url) {
              chosenPage = page
              break
            }
          }
          // opened page
          // move mouse around center in case it needs it?
          await chosenPage.mouse.move(dims.width/2, dims.height/2);
          await sleep(10)
          await chosenPage.mouse.move(dims.width/2+1, dims.height/2+1);

          await chosenPage.screenshot({path: `./${config.largeImagePath}/${tokenId}.png`, omitBackground: true});
          await browserPage.close()
          await chosenPage.close()
        }
        // create thumbnails from display or from created image
        objThumbnails[tokenId] = await createThumbnails(`${tokenId}.png`, tokenId)

        canDeleteLarge.push(`${config.largeImagePath}/${tokenId}.png`)
      }

      if (fillMode) {
        // delete any temporary files if asked
        if (config.fillMode.deleteDownloadsAfterCreation) {
          for (let file of canDeleteDownload) {
            fs.unlinkSync(file)
          }
        }
        if (config.fillMode.deleteLargeAfterCreation) {
          for (let file of canDeleteLarge) {
            fs.unlinkSync(file)
          }
        }

        if (!objThumbnails[tokenId]) {
            addWarning(`Missing thumbnail info for ${tokenId}.`)
        } else {
          const objData = objThumbnails[tokenId].map(meta => {
            const o = {
              mimeType: meta.mime,
              file: meta.file,
              fileSize: meta.fileSize,
              dimensions: {
                value: `${meta.width}x${meta.height}`,
                unit: 'px'
              }
            }
            if (meta.duration) {
              o.duration = meta.duration
            }
            return o
          })
          fs.writeFileSync(`${config.fillMode.objPath}/${tokenId}.json` , JSON.stringify(objData, '', 2))
          if (objOriginal[tokenId]) {
            fs.writeFileSync(`${config.fillMode.objPath}/${tokenId}-original.json` , JSON.stringify(objOriginal[tokenId], '', 2))
          }
        }
      }
    }
  }
  await browser.close();

  if (!fillMode) {
    // copy data
    const niceData = await getNiceData(collected, created)
    fs.writeFileSync(`${config.distPath}/data.json`, JSON.stringify(niceData, '', 2))
  }
}

main()
  .catch(e => console.log(e))
  .finally(async () => {})