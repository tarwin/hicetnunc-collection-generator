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
- `thumbnail`: options for thumbnail generation
  - `path: string`: the directory under your `distPath` to store generated thumbnails
  - `image : Array<{sizes, formats}>`: an array of image thumbnail versions to create
    - `sizes : Array<int>`: width of generated thumbs
    - `formats : Array<string>`: format of thumbnails
  - `video: Array<int>`: size of video thumbnails to create (TODO)
- `ignoreObjects`: list of OBJKT IDs to ignore when generating

# Run

- In two different CLIs run:
  - `serve -C`
  - `npm start`

# Viewing

- run `npm run serve-dist`
- open a URL displayed

This is just a simple test so far.

# Depoying

I have my `/dist/` directory connected to Github, and have Netlify watching this repo. To update I simply run the tool and then push inside the `/dist/` directory.

# Thanks

- @quasimondo scraper: https://gist.github.com/Quasimondo/30416ce22243610a9c95424e8796b008
- all @hicetnunc2000 community