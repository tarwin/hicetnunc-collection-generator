// ----------------------
// config
const config = require('./config.json')

const browserWidth = config.puppetSize;
const browserHeight = config.puppetSize;

// ------------------------------------------------------------------
// libs
const fs = require('fs');
const puppeteer = require('puppeteer');
const ipfsClient = require('ipfs-http-client')
const fetch = require('node-fetch')
// const PuppeteerVideoRecorder = require('puppeteer-video-recorder');

const {
  createThumbnails,
  createLargeImage,
  resizeImageToMaxSize,
  sleep,
  getMaxDimensions,
  niceExec,
  downloadFile,
  getImageMetadata
} = require('./utils')

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

// create directories if they don't exist
const thumbnailPath = `${config.distPath}/${config.thumbnail.path}`
if (!fs.existsSync(config.downloadPath)) fs.mkdirSync(config.downloadPath)
if (!fs.existsSync(config.largeImagePath)) fs.mkdirSync(config.largeImagePath)
if (!fs.existsSync(config.distPath)) fs.mkdirSync(config.distPath)
if (!fs.existsSync(thumbnailPath)) fs.mkdirSync(thumbnailPath)

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

  const res = await fetch(`https://51rknuvw76.execute-api.us-east-1.amazonaws.com/dev/tz?tz=${config.ownerAddress}`)
  const objects = (await res.json()).result.filter(obj => {
    // filter out unwanted
    return !config.ignoreObjects.includes(obj.token_id)
  })

  // items you own, others are ones you created
  const collected = objects.filter(d => !d.token_info.creators.includes(config.ownerAddress))
  const created = objects.filter(d => d.token_info.creators.includes(config.ownerAddress))
  console.log('COLLECTED: ', collected.length)
  console.log('CREATED: ', created.length)

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

  // go through each object
  for (let obj of objects) {
    const tokenId = obj.token_id

    const mime = obj.token_info.formats[0].mimeType
    const converter = converters[mime]

    const ipfsUri = obj.token_info.artifactUri.substr(7)
    // could use another IPFS HTTP gateway?
    const url = config.cloudFlareUrl + ipfsUri

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
        console.log(`Written "${filename}"`)
      } else {
        console.log(`Exists "${filename}"`)
      }
    }

    // if we actually have a converter for this mime type
    // we should have one for each, but if more are added maybe not?
    if (converter) {

      // skip for existing thumbnails (only checks first folder)
      if (fs.existsSync(`${thumbnailPath}/${tokenId}-${config.thumbnail.image.sizes[0]}.${config.thumbnail.image.formats[0]}`)) {
        continue
      }

      if (converter.use === 'sharp') {
        // making thumb
        fs.copyFileSync(`${config.downloadPath}/${filename}`, `${config.largeImagePath}/${filename}`)
        await createThumbnails(filename, tokenId)
      } else if (converter.use === 'ffmpeg') {
        // remove if exists, otherwise FFMPEG may complain
        if (fs.existsSync(`${config.largeImagePath}/${tokenId}.png`)) {
          fs.unlinkSync(`${config.largeImagePath}/${tokenId}.png`) 
        }
        // extract image from middle of video
        const info = await niceExec(`ffprobe ${config.downloadPath}/${filename} 2>&1`)
        const durationMatch = info.match(/Duration: ([0-9][0-9]):([0-9][0-9]):([0-9][0-9]\.[0-9]+)/i)
        if (durationMatch) {
          let midpoint = (parseFloat(durationMatch[3]) + parseInt(durationMatch[2]) * 60 + parseInt(durationMatch[1]) * 3600) / 2
          let convertCommand = `ffmpeg -i ${config.downloadPath}/${filename} -vcodec mjpeg -vframes 1 -an -f rawvideo`
          convertCommand += ` -ss ${midpoint}`
          convertCommand += ` ${config.largeImagePath}/${tokenId}.png`
          await niceExec(convertCommand)
  
          await createThumbnails(`${tokenId}.png`, tokenId)
        } else {
          console.log('Failed creating large for video', tokenId)
        }
      } else if (converter.use === 'html') {
        // has thumb
        if (obj.token_info.displayUri) {
          const displayIpfsUri = obj.token_info.displayUri.substr(7)
          const displayUrl = config.cloudFlareUrl + displayIpfsUri
          await downloadFile(displayUrl, `${config.downloadPath}/${tokenId}_display`)
          // rename to correct ext
          const meta = await getImageMetadata(`${config.downloadPath}/${tokenId}_display`)
          fs.renameSync(`${config.downloadPath}/${tokenId}_display`, `${config.downloadPath}/${tokenId}.${meta.format}`)
          fs.copyFileSync(`${config.downloadPath}/${tokenId}.${meta.format}`, `${config.largeImagePath}/${tokenId}.${meta.format}`)
          // create thumbnail
          await createThumbnails(`${tokenId}.${meta.format}`, tokenId)
        } else {
          // could use puppeteer to make a thumb but these SHOULD have them defined
          console.log(`ERROR: Missing "displayUri" for ${tokenId}`)
        }
      } else if (converter.use === 'gltf') {
        // don't think GL requires a displayUri so we're just going to have
        // to make thumbs ourselves.
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

        await createThumbnails(`${tokenId}.png`, tokenId)
      } else if (converter.use === 'svg') {
        // has thumb
        if (obj.token_info.displayUri) {
          const displayIpfsUri = obj.token_info.displayUri.substr(7)
          const displayUrl = config.cloudFlareUrl + displayIpfsUri
          await downloadFile(displayUrl, `${config.downloadPath}/${tokenId}_display`)
          // rename to correct ext
          const meta = await getImageMetadata(`${config.downloadPath}/${tokenId}_display`)
          fs.renameSync(`${config.downloadPath}/${tokenId}_display`, `${config.downloadPath}/${tokenId}.${meta.format}`)
          await createLargeImage(`${tokenId}.${meta.format}`, tokenId)
        } else {
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
        await createThumbnails(`${tokenId}.png`, tokenId)
      }
    }
  }
  await browser.close();

  // copy data
  const niceData = await getNiceData(collected, created)
  fs.writeFileSync(`${config.distPath}/data.json`, JSON.stringify(niceData, '', 2))
}

main()
.catch(e => console.log(e))
.finally(async () => {
})