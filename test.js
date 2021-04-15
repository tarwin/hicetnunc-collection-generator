const ownerAddress = 'tz1g7Aaac9ssD7cDUTngyXyx8QiVUsAVZCjQ'
const cloudFlareUrl = 'https://cloudflare-ipfs.com/ipfs/'

const sharp = require('sharp');
const fetch = require('node-fetch');
const fs = require('fs');
const axios = require('axios');
const ffmpeg = require('ffmpeg');
const { exec } = require("child_process");
const puppeteer = require('puppeteer');


// avatar
// https://services.tzkt.io/v1/avatars2/tz1g7Aaac9ssD7cDUTngyXyx8QiVUsAVZCjQ

// creator info
// https://api.tzkt.io/v1/accounts/tz1g7Aaac9ssD7cDUTngyXyx8QiVUsAVZCjQ/metadata

/*
{
  ipfsHash: 'QmYBJd8jtVvLqChBZb7T5j3e6ALCXAKn4fXBFNLeZp4VBC',
  piece: '27668',
  amount: 1,
  token_info: {
    name: 'adam',
    description: '180f 600px @p1xelfool',
    tags: [ 'gif', 'internetart', 'loop', 'code', 'generative' ],
    symbol: 'OBJKT',
    artifactUri: 'ipfs://QmSwWBcnHMcC7pyQg5oWj7Po7wAxB8MbLcYmdRccRska9r',
    displayUri: '',
    creators: [ 'tz1TxDL7npfYDSyvrZFC4deUPMySvsL6xARU' ],
    formats: [ [Object] ],
    thumbnailUri: 'ipfs://QmNrhZHUaEqxhyLfqoq1mtHSipkWHeT31LNHb1QEbDHgnc',
    decimals: 0,
    isBooleanAmount: false,
    shouldPreferSymbol: false
  },
  token_id: 27668
}
*/

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
      console.log(`stdout: ${stdout}`);
      resolve(stdout)
    });
  })
}

const browserWidth = 2000;
const browserHeight = 2000;

const converters = {
  'image/gif': { use: 'sharp', ext: 'gif' },
  'image/png': { use: 'sharp', ext: 'png' },
  'image/jpeg': { use: 'sharp', ext: 'jpg' },
  'image/webp': { use: 'sharp', ext: 'webp' },
  'image/tiff': { use: 'sharp', ext: 'tiff' },
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

// format: 'png',
// width: 5400,
// height: 5400,
// pages: 225, num frames
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

const getMaxDimensions = (width, height, maxDim) => {
  let w = width
  let h = height
  if (width <= maxDim && height <= maxDim) {
    w = maxDim
    h = maxDim
  } else if (width === height) {
    w = maxDim
    h = maxDim
  } else if (width > height) {
    w = maxDim
    h = height / width * maxDim
  } else {
    w = width / height * maxDim
    h = maxDim
  }
  return {
    width: Math.round(w),
    height: Math.round(h)
  }
}

const resizeImageToMaxSize = async (maxDim, inFile, outFile) => {
  const meta = await getImageMetadata(inFile)
  const dims = getMaxDimensions(meta.width, meta.height, maxDim)
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

const main = async () => {

  const data = require('./data.json').result

  // const res = await fetch('https://51rknuvw76.execute-api.us-east-1.amazonaws.com/dev/tz', {
  //   method: 'post',
  //   body: JSON.stringify({ tz: ownerAddress })
  // })
  // const data = await res.json()
  // console.log(data)

  const owned = data.filter(d => !d.token_info.creators.includes(ownerAddress))
  console.log('OWNED: ', owned.length)

  // 1. Launch the browser
  const browser = await puppeteer.launch({
      defaultViewport: {
          width: browserWidth,
          height: browserHeight,
          isLandscape: true
      },
      dumpio: true,
      headless: false,
      args: [
        '--hide-scrollbars',
        '--mute-audio'
      ],
  });
  // 2. Open a new page
  const browserPage = await browser.newPage();

  for (let obj of owned) {
    const ipfsUri = obj.token_info.artifactUri.substr(7)
    const url = cloudFlareUrl + ipfsUri
    const mime = obj.token_info.formats[0].mimeType
    const converter = converters[mime]
    if (converter) {
      // write actual
      const filename = `${obj.piece}.${converter.ext}`

      if (!fs.existsSync(`./out/full/${filename}`)) {
        console.log(`Downloading ${obj.piece}`)
        if (converter.use === 'ffmpeg') {
          await niceExec(`python3 download.py ${ipfsUri} ${filename}`)
        } else {
          await downloadFile(url, `./out/full/${filename}`)
        }
        console.log(`Written "${filename}"`)
      } else {
        console.log(`Exists "${filename}"`)
      }

      // skip thumbs for existing
      if (fs.existsSync(`./out/thumb_400/${obj.piece}.webp`) && converter.use !== 'svg') {
        continue
      }

      if (converter.use === 'sharp') {
        // making thumb
        await resizeImageToMaxSize(400, `./out/full/${filename}`, `./out/thumb_400/${obj.piece}.webp`)
        await resizeImageToMaxSize(800, `./out/full/${filename}`, `./out/thumb_800/${obj.piece}.webp`)
        await resizeImageToMaxSize(128, `./out/full/${filename}`, `./out/thumb_128/${obj.piece}.webp`)
      } else if (converter.use === 'ffmpeg') {
        // remove if exists middle image
        fs.unlinkSync(`./out/full/${obj.piece}.png`)
        // extract image from middle of video
        let convertCommand = `ffmpeg -i ./out/full/${filename} -vcodec mjpeg -vframes 1 -an -f rawvideo`
        convertCommand += ` -ss \`ffmpeg -i ./out/full/${filename} 2>&1 | grep Duration | awk '{print $2}' | tr -d , | awk -F ':' '{print ($3+$2*60+$1*3600)/2}'\``
        convertCommand += ` ./out/full/${obj.piece}.png`
        await niceExec(convertCommand)

        await resizeImageToMaxSize(400, `./out/full/${obj.piece}.png`, `./out/thumb_400/${obj.piece}.webp`)
        await resizeImageToMaxSize(800, `./out/full/${obj.piece}.png`, `./out/thumb_800/${obj.piece}.webp`)
        await resizeImageToMaxSize(128, `./out/full/${obj.piece}.png`, `./out/thumb_128/${obj.piece}.webp`)
      } else if (converter.use === 'html') {
        // has thumb
        if (obj.token_info.displayUri) {
          const displayIpfsUri = obj.token_info.displayUri.substr(7)
          const displayUrl = cloudFlareUrl + displayIpfsUri
          await downloadFile(displayUrl, `./out/full/${obj.piece}_display`)
          // rename to correct ext
          const meta = await getImageMetadata(`./out/full/${obj.piece}_display`)
          fs.renameSync(`./out/full/${obj.piece}_display`, `./out/full/${obj.piece}.${meta.format}`)
          // create thumbnail
          await resizeImageToMaxSize(400, `./out/full/${obj.piece}.${meta.format}`, `./out/thumb_400/${obj.piece}.webp`)
          await resizeImageToMaxSize(800, `./out/full/${obj.piece}.${meta.format}`, `./out/thumb_800/${obj.piece}.webp`)
          await resizeImageToMaxSize(128, `./out/full/${obj.piece}.${meta.format}`, `./out/thumb_128/${obj.piece}.webp`)
        } else {
          console.log(`ERROR: Missing "displayUri" for ${obj.piece}`)
        }
      } else if (converter.use === 'gltf') {
        // console.log('gltf', obj.piece, mime, obj.token_info.displayUri)
        const url = `http://localhost:5000/out/full/${obj.piece}.gltf`

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
              }
            </style>
          </head>
          <body>
            <model-viewer id="viewer" src="${url}" auto-rotate></model-viewer>
            <script>
              const modelViewerParameters = document.querySelector('model-viewer#viewer');
              modelViewerParameters.addEventListener('model-visibility', (e) => {
                setTimeout(() => {
                  const d = document.createElement('div')
                  d.setAttribute('id', 'done')
                  document.body.appendChild(d)
                }, 1000)
              });
            </script>
          </body>
        </html>`
        
        let base64Html = Buffer.from(html).toString('base64');

        await browserPage.goto(`data:text/html;base64,${base64Html}`);
        console.log('Waiting for visibility')
        await browserPage.waitForSelector('#done')
        console.log('Visible')
        await browserPage.screenshot({path: `./out/full/${obj.piece}.png`, omitBackground: true});

        await resizeImageToMaxSize(400, `./out/full/${obj.piece}.png`, `./out/thumb_400/${obj.piece}.webp`)
        await resizeImageToMaxSize(800, `./out/full/${obj.piece}.png`, `./out/thumb_800/${obj.piece}.webp`)
        await resizeImageToMaxSize(128, `./out/full/${obj.piece}.png`, `./out/thumb_128/${obj.piece}.webp`)
      } else if (converter.use === 'svg') {
        // has thumb
        if (obj.token_info.displayUri) {
          const displayIpfsUri = obj.token_info.displayUri.substr(7)
          const displayUrl = cloudFlareUrl + displayIpfsUri
          await downloadFile(displayUrl, `./out/full/${obj.piece}_display`)
          // rename to correct ext
          const meta = await getImageMetadata(`./out/full/${obj.piece}_display`)
          fs.renameSync(`./out/full/${obj.piece}_display`, `./out/full/${obj.piece}.${meta.format}`)
        } else {
          const url = `http://localhost:5000/out/full/${obj.piece}.svg`
          const meta = await getImageMetadata(`./out/full/${obj.piece}.svg`)
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

          await browserPage.goto(`data:text/html;base64,${base64Html}`);
          console.log('Waiting for visibility')
          await browserPage.waitForSelector('#done')
          console.log('Visible')
          let chosenPage = null
          for (let page of await browser.pages()) {
            if (await page.url() === url) {
              chosenPage = page
              break
            }
          }
          // opened page
          await chosenPage.screenshot({path: `./out/full/${obj.piece}.png`, omitBackground: true});
          await resizeImageToMaxSize(400, `./out/full/${obj.piece}.png`, `./out/thumb_400/${obj.piece}.webp`)
          await resizeImageToMaxSize(800, `./out/full/${obj.piece}.png`, `./out/thumb_800/${obj.piece}.webp`)
          await resizeImageToMaxSize(128, `./out/full/${obj.piece}.png`, `./out/thumb_128/${obj.piece}.webp`)
        }
      }
    }
  }
  // close browser
  await browser.close();
}

main()
.catch(e => console.log(e))