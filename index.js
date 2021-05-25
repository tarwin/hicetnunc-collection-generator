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
  createLargeFromBmp,
  createLargeFromVideo,
  askQuestion
} = require('./utils')

// ----------------------
// config
let config = require('./config.json')
if (getArgs()[0]) {
  config = require(`./config.${getArgs()[0]}.json`)
}
config.forceGeneration = config.forceGeneration || []

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
const { curly } = require('node-libcurl')
const express = require('express')
// const localtunnel = require('localtunnel')
// const PuppeteerVideoRecorder = require('puppeteer-video-recorder');

const expressApp = express()
const expressPort = 5001
let expressServer
// let tunnelUrl

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
}

function addWarning(str) {
  console.log('\n\x1b[33m%s\x1b[0m', `WARNING: ${str}`)
  fs.appendFileSync(errorLog, `\n${str}`)
}

const getNiceDataObjects = async(objects) => {
  const out = []
  for (let obj of objects) {
    const cidv1 = new ipfsClient.CID(obj.artifact_uri.substr(7)).toV1()
    const subomain = cidv1.toString()
    out.push({
      id: obj.token_id,
      name: obj.name,
      description: obj.description,
      tags: obj.tags,
      creatorAddress: obj.creators[0],
      mime: obj.formats[0].mimeType,
      artifactUri: obj.artifact_uri,
      cid: subomain,
      formats: obj.formats,
      gifThumb: obj.gifThumb,
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

const getUserObjkts = async(address) => {
  console.log('Getting OBJKT count')
  let apiUrl = `https://api.better-call.dev/v1/account/mainnet/${address}/token_balances`
  // const res = await fetch(apiUrl)
  const { data: baseJson } = await curly.get(apiUrl)
  // const baseJson = JSON.parse(res)
  const total = baseJson.total
  console.log('All OBJKTs:', total)
  let allObj = []
  for (let i=0; i<Math.ceil(total / 10); i++) {
    console.log(`Get data for ${i*10}-${i*10+10} - ${apiUrl}` + `?size=10&offset=${i*10}`)
    const { data: json } = await curly.get(apiUrl + `?size=10&offset=${i*10}`)
    // make sure they at least have a token
    allObj.push(...json.balances)
    allObj = allObj.filter(o => o.token_id)
    // may have to wait?
    if (i && i % 10 === 0) {
      await sleep(5000)
    }
  }
  // remove any multiples
  const added = []
  const creatorLookup = fs.existsSync('./creator_lookup.json') ? JSON.parse(fs.readFileSync('./creator_lookup.json')) : {}
  for (let o of allObj) {
    if (!o.creators) {
      if (creatorLookup[o.token_id]) {
        o.creators = creatorLookup[o.token_id]
        continue
      }
      console.log(`Getting missing creators for OBJKT ${o.token_id}`)
      try {
        const { data: jsonObj } = await curly.get(`https://1xgf1e26jb.execute-api.us-east-1.amazonaws.com/dev/objkt?id=${o.token_id}`)
        if (jsonObj && jsonObj.result && jsonObj.result.token_info && jsonObj.result.token_info.creators) {
          o.creators = jsonObj.result.token_info.creators
        } else {
          addWarning(`Missing creators for OBJKT ${o.token_id}`)
        }
      } catch (e) {
        addWarning(`ERROR when getting data for OBJKT ${o.token_id}`)
      }
    }
  }

  // save a list of creators for lookup if we run again
  const newCreatorLookup = allObj.map(o => {
    return {
      token_id: o.token_id,
      creators: o.creators
    }
  })
  const creatorsMap = {}
  newCreatorLookup.forEach(o => creatorsMap[o.token_id] = o.creators)
  fs.writeFileSync('./creator_lookup.json', JSON.stringify({ ...creatorLookup, ...creatorsMap }, null, 2))

  // a bunch of filtering
  allObj = allObj.filter(o => {
    // get rid of non OBJKTs
    if (o.symbol !== 'OBJKT') return false
    // get rid of things you DID own but burnt
    if ((o.balance === 0 || o.balance === '0') && !(o.creators && o.creators.includes(config.ownerAddress))) return false
    // only add once
    if (!added.includes(o.token_id)) {
      added.push(o.token_id)
      return true
    }
    return false
  })
  return allObj
}

// ------------------------------------------------------------------
// main func / loop
const main = async () => {

  let objects = []
  if (!fillMode) {
    objects = await getUserObjkts(config.ownerAddress)
    objects = objects.sort((a, b) => {
      return a.token_id - b.token_id
    })
  } else {
    objects = require(config.fillMode.data)
    // have to sort first
    objects = objects.sort((a, b) => {
      return a.token_id - b.token_id
    })

    let offset = config.fillMode.offset
    if (config.fillMode.startAtObjectNumber) {
      console.log('startAtObjectNumber', config.fillMode.startAtObjectNumber)
      offset = objects.findIndex(o => o.token_id === config.fillMode.startAtObjectNumber)
    }
    if (config.fillMode.limit || offset) {
      let start = offset || 0
      let end = config.fillMode.limit ? (start + config.fillMode.limit) : objects.length
      if (end > objects.length - 1) {
        end = objects.length - 1
      }
      console.log(`Slicing: ${start} => ${end}`)
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

  // items you own, others are ones you created
  if (!fillMode) {
    console.log('COLLECTED: ', objects.filter(d => d.creators && !d.creators.includes(config.ownerAddress)).length)
    console.log('CREATED: ', objects.filter(d => d.creators && d.creators.includes(config.ownerAddress)).length)
  }

  // start puppeteer
  const browser = await puppeteer.launch({
      // use chrome instead of chromium because it wasn't working :(
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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

  let totalToProcess = objects.length
  let currentlyProcessing = 0

  // go through each object
  for (let obj of objects) {
    const tokenId = obj.token_id
    try {
      let mime
      let ipfsUri

      currentlyProcessing++
      console.log(`\n${currentlyProcessing} / ${totalToProcess}`)

      if (fillMode) {
        if (!obj.formats || !obj.formats[0] || !obj.formats[0].mimeType) {
          console.warn(`No formats for ${tokenId}.`)
          continue
        }
        mime = obj.formats[0].mimeType
        ipfsUri = obj.artifact_uri.substr(7)
      } else {
        mime = obj.formats[0].mimeType
        ipfsUri = obj.artifact_uri.substr(7)
      }

      const converter = converters[mime]

      console.log(`Name`, obj.name)
      console.log(`MIME`, mime)

      if (!converter) {
        addWarning(`No converter for ${tokenId} - MIME: ${mime}`)
        continue
      }

      // could use another IPFS HTTP gateway?
      const url = config.cloudFlareUrl + ipfsUri

      const canDeleteDownload = []
      const canDeleteLarge = []

      // write actual
      let filename = `${tokenId}.${converter.ext}`
      console.log(`====================\nProcessing ${filename}`)

      // if we don't have the original file download it
      if (!fs.existsSync(`${config.downloadPath}/${filename}`)) {
        console.log(`Downloading ${tokenId}`)
        // for some reason I couldn't simply use `fetch` to download from IPFS
        // something to do with HTTP Partial Content and me not wanting to handle it
        if (converter.use === 'ffmpeg') {
          // so yeah, I use stolen python code instead ...
          await niceExec(`python3 download.py ${ipfsUri} ${config.downloadPath} ${filename}`)
        } else if (converter.use === 'html') {
          const displayUri = await getDisplayUri(obj)
          if (displayUri) {
            const displayIpfsUri = displayUri.substr(7)
            const displayUrl = config.cloudFlareUrl + displayIpfsUri
            await downloadFile(displayUrl, `${config.downloadPath}/${tokenId}_display`)
            // rename to correct ext
            const meta = await getImageMetadata(`${config.downloadPath}/${tokenId}_display`)
            fs.renameSync(`${config.downloadPath}/${tokenId}_display`, `${config.downloadPath}/${tokenId}.${meta.format}`)
            fs.copyFileSync(`${config.downloadPath}/${tokenId}.${meta.format}`, `${config.largeImagePath}/${tokenId}.${meta.format}`)

            // needs the filename of downloaded file, not HTML
            filename = `${tokenId}.${meta.format}`
          } else {
            // could use puppeteer to make a thumb but these SHOULD have them defined
            addWarning(`Missing "displayUri" for ${tokenId}`)
          }
        } else {
          await downloadFile(url, `${config.downloadPath}/${filename}`)
        }
        canDeleteDownload.push(`${config.downloadPath}/${filename}`)
        console.log(`Written "${filename}"`)
      } else {
        console.log(`Exists "${filename}"`)
      }

      // if we actually have a converter for this mime type
      // we should have one for each, but if more are added maybe not?
      if (converter) {

        // has to be done before quick exit
        let downloadImageSize
        downloadImageSize = fs.statSync(`${config.downloadPath}/${filename}`).size
        if (converter.ext === 'gif' && downloadImageSize <= config.thumbnail.maxGifSizeKb * 1024) {
          obj.gifThumb = true
        }

        if (!config.forceGeneration.includes(converter.use)) {
          // skip for existing thumbnails
          if (fs.existsSync(`${thumbnailPath}/${tokenId}-${config.thumbnail.image.sizes[0]}.${config.thumbnail.image.formats[0].type}`)) {
            continue
          }
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
          // add SVG
          objThumbnails[tokenId].push({
            mimeType: 'image/svg+xml',
            file: `${tokenId}.svg`,
            fileSize: 12691,
            width: 200,
            height: 81,
          })
          const duration = await getVideoOrGifDuration(`${config.downloadPath}/${filename}`)
          objOriginal[tokenId] = { duration }

          canDeleteLarge.push(`${config.largeImagePath}/${tokenId}.svg`)
        } else if (converter.use === 'sharp' || converter.use === 'html') {
          if (converter.ext === 'bmp') {
            // bmps are annoying! sharp doesn't do 'em
            await createLargeFromBmp(`${config.downloadPath}/${filename}`, tokenId)
            
            objThumbnails[tokenId]= await createThumbnails(`${tokenId}.png`, tokenId)

            const preMeta = await getImageMetadata(`${config.largeImagePath}/${tokenId}.png`)
            objOriginal[tokenId] = {
              width: preMeta.width,
              height: preMeta.height
            }

            canDeleteLarge.push(`${config.largeImagePath}/${tokenId}.png`)
          } else {
            if (!fs.existsSync(`${config.largeImagePath}/${filename}`)) {
              fs.copyFileSync(`${config.downloadPath}/${filename}`, `${config.largeImagePath}/${filename}`)
            }
            let preMeta
            try {
              preMeta = await getImageMetadata(`${config.largeImagePath}/${filename}`)
            } catch (e) {
              addWarning(`${tokenId} - ${e.toString()}`)
              canDeleteLarge.push(`${config.largeImagePath}/${filename}`)
              continue
            }
            if (preMeta.format !== 'gif') {
              objThumbnails[tokenId]= await createThumbnails(filename, tokenId)
            } else {
              // single frame so just make thumbs as expected
              if (preMeta.pages === 1) {
                objThumbnails[tokenId]= await createThumbnails(filename, tokenId)
              } else {
                // if smaller than X use GIF
                if (downloadImageSize <= config.thumbnail.maxGifSizeKb * 1024) {
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
              width: preMeta.width,
              height: preMeta.height
            }

            canDeleteLarge.push(`${config.largeImagePath}/${filename}`)
          }
        } else if (converter.use === 'ffmpeg') {
          if (!fs.existsSync(`${config.largeImagePath}/${tokenId}.png`)) {
            await createLargeFromVideo(filename, tokenId)
          }
          // create video thumbs
          objThumbnails[tokenId] = await createVideoThumbnailsFromVideo(`${config.downloadPath}/${filename}`, `${config.largeImagePath}/${tokenId}.png`, tokenId)

          // we might not create if single frame video
          let duration = 0
          if (objThumbnails[tokenId].length) {
            // get duration of video thumb
            duration = await getVideoOrGifDuration(`${thumbnailPath}/${objThumbnails[tokenId][0].file}`)
            objThumbnails[tokenId].forEach(o => o.duration = duration)
          }

          // create image thumbs
          objThumbnails[tokenId] = objThumbnails[tokenId].concat(await createThumbnails(`${tokenId}.png`, tokenId))

          const widthHeight = await getVideoWidthHeight(`${config.downloadPath}/${filename}`)
          objOriginal[tokenId] = {
            width: widthHeight.width,
            height: widthHeight.height,
            duration
          }

          canDeleteLarge.push(`${config.largeImagePath}/${tokenId}.png`)
        } else if (converter.use === 'gltf') {
          // don't think GL requires a displayUri so we're just going to have
          // to make thumbs ourselves.
          if (!fs.existsSync(`${config.largeImagePath}/${tokenId}.png`)) {
            const contentUrl = `http://localhost:${expressPort}/public/${config.downloadPath}/${tokenId}.gltf`

            const vars = {
              __browserWidth__: browserHeight,
              __browserHeight__: browserHeight,
              __url__: contentUrl
            }

            const browserPage = await browser.newPage()
            const browserUrl = `http://localhost:${expressPort}/?template=3d&vars=${encodeURIComponent(JSON.stringify(vars))}`
            await browserPage.goto(browserUrl)
            console.log(`Loading ${browserUrl}`)
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
            const url = `http://localhost:${expressPort}/public/${config.downloadPath.substr(2)}/${tokenId}.svg`
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
        } // end fill mode?
      } // end if converter
      console.log('\n\n')
    } catch (e) {
      addWarning(`${tokenId} - ${e.toString()}`)
    }
  } // end loop
  await browser.close();

  if (!fillMode) {
    // copy data
    const niceData = await getNiceData(
      objects.filter(d => d.creators && !d.creators.includes(config.ownerAddress)),
      objects.filter(d => d.creators && d.creators.includes(config.ownerAddress)),
      objects
    )
    fs.writeFileSync(`${config.distPath}/data.json`, JSON.stringify(niceData, '', 2))
  }
}

expressApp.use('/public', express.static('./'))

expressApp.get('/', (req, res) => {
  if (!req.query || !Object.keys(req.query).length) {
    return res.send('Content server working.')
  }

  const templateReq = req.query.template
  const vars = JSON.parse(req.query.vars)
  let template = fs.readFileSync(`./creation-templates/${templateReq}.html`, { encoding: 'utf8' })
  for (let v of Object.keys(vars)) {
    template = template.replace(new RegExp(v, 'g'), vars[v])
  }
  res.send(template)
})

expressServer = expressApp.listen(expressPort, async () => {
  console.log(`Server listening on http://localhost:${expressPort}`)

  // const tunnel = await localtunnel({ port: expressPort });
  // tunnelUrl = tunnel.url

  // console.log('Before continueing please allow the tunnel access by going to the following URL.')
  // console.log(`\n\x1b[33m%s\x1b[0m\n`, tunnelUrl)

  // await askQuestion('Press ENTER to continue.')
  
main()
  .catch(e => console.log(e))
  .finally(() => {
    console.log('Complete')
    if (expressServer) {
      console.log('Closing server')
      expressServer.close()
      process.exit(0)
    }
  })
})