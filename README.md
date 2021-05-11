# Example

[See live example](https://zealous-swartz-f72bdd.netlify.app/)
# What the  ?

A tool for downloading the files from your Hic Et Nunc collection (https://www.hicetnunc.xyz/) and then creating thumbnails.

It should generate thumbnails for static images, videos, HTML pages, SVG and even 3D models!

What's the point? Well there will be a static site generator coming soon so you can have a nice little gallery of your collection wherever you want.

Can also be used as a slideshow. Add it to a screen or even Chromecast.

# The code

It's a mess. I know. Just hacking things together as quick as possible to see if it works. It does. Kinda. I hope. If you want to make it nicer please fork / pull request.

Also thanks to 

# Requirements

- `npm install`
- serve: `npm install -g serve`
- python3
- python3: `python -m pip install ipfsapi` (IPFS API)
- For PDFs: `brew install imagemagick ghostscript poppler` (sorry MacOS only ATM)

# First

- Just set the `ownerAddress` in config.

# Config

- `ownerAddress : string`: your Tezos wallet address
- `cloudFlareUrl : string`: at the moment just leave this ...
- `downloadPath : string`: the location to store downloaded files
- `largeImagePath : string`: the location to store large images
- `distPath : string`: the location for generated data
- `puppetSize`: the size of large images for HTML, SVG and GLTF (browser size)
- `fillMode: object`: if set runs in a different mode. Used to fill out missing information in H=N database
    `data: string`: ie `./fill.json` the data to load OBJKTs from
    `uploadToIpfs: boolean`: (currently unsupported) if `true` uploads created thumbs to IPFS
    `deleteDownloadsAfterCreation: boolean`: if `true` deletes downloaded files after each is processed
    `deleteLargeAfterCreation: boolean`: if `true` deletes large images after thumbnail creation
    `objPath: string`: ie `./tmp/obj` where to store JSON files with info about created tnumbnails. Also stores error file.
    `limit: int`: if set above `0` will only process this # of OBJKTs,
    `offset: int`: if set above `0` will process from this # in the queue,
    `startAtObjectNumber: int`: if set above `0` will override `offset` and start at OBJKT with this `token_id`
- `thumbnail`: options for thumbnail generation
  - `path: string`: the directory under your `distPath` to store generated thumbnails
  - `maxGifSizeKb`: size in KBs before GIFs are converted to videos
  - `image: {formats, sizes}`: format and sizes for image thumbnails
    - `formats: Array<{type, options}>`
      - `type: string`: one of `jpeg`, `png`, `avif`, `webp`
      - `options: object`: valid options object for type from Sharp (https://sharp.pixelplumbing.com/api-output) 
    - `sizes Array<int>:`: width dimension for thumbnails
  - `video: {formats, sizes, maxLengthSeconds}`: options, format and sizes for video thumbnails
    - `maxLengthSeconds: float`: maximum length in seconds for video thumbnails ie `15` will truncate all video thumbnails to 15 seconds long (max)
    - `formats`: currently ignored
    - `sizes Array<int>:`: width dimension for thumbnails
- `ignoreObjects: Array<int>`: list of OBJKT IDs to ignore when generating
- `onlyObjects: Array<int>`: only process OBJKTs with these IDs

# Run

- In two different CLIs run:
  - `serve -C`
  - then `npm start`

# Viewing

- run `npm run serve-dist`
- open a URL displayed

# Depoying

I have my `/dist/` directory connected to Github, and have Netlify watching this repo. To update I simply run the tool and then push inside the `/dist/` directory.

# Thanks

- @quasimondo scraper: https://gist.github.com/Quasimondo/30416ce22243610a9c95424e8796b008
- all @hicetnunc2000 community