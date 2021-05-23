const fs = require('fs')
const createClient = require('ipfs-http-client')
const infuraUrl = 'https://ipfs.infura.io:5001'
const ipfs = createClient(infuraUrl)

const processObj = async function(n) {
  console.log(`Trying OBJKT ${n}`)
  if (!fs.existsSync(`./tmp/obj/${n}.json`)) {
    console.log('No OBJKT')
    return
  }
  if (fs.existsSync(`./processed/${n}.json`)) {
    console.log('Already complete')
    return
  }
  const jsonData = fs.readFileSync(`./tmp/obj/${n}.json`)
  const obj = JSON.parse(jsonData)
  for (let format of obj) {
    console.log(`Uploading ${format.file}`)
    var fileBuffer = fs.readFileSync(`./tmp/thumbs/${format.file}`)
    const info = await ipfs.add(fileBuffer)
    format.path = info.path
    format.cid = info.cid.toString()
    console.log(`Done ${format.path}`)
  }
  fs.writeFileSync(`./processed/${n}.json`, JSON.stringify(obj, null, 2))
}

const main = async function() {
  for (let n=1; n<60000; n++) {
    await processObj(n)
  }
}

main()