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

# First

- Just set the `ownerAddress` in config.

# Config

- `ownerAddress : string`: your Tezos wallet address
- `cloudFlareUrl : string`: at the moment just leave this ...
- `downloadPath : string`: the location to store downloaded files
- `largeImagePath : string`: the location to store large images
- `distPath : string`: the location for generated data
- `thumbnail`: options for thumbnail generation
  - `path: string`: the directory under your `distPath` to store generated thumbnails
  - `image : Array<{size, type, path}>`: an array of image thumbnail versions to create
    - `size : int`: width or height, depending on type
    - `type : string`: can be one of `contain`, `width` or `height`
    - `path : string`: the path under `thumbnailPath` to store these thumbnails

*Only `"type": "contain"` works so far*

# Run

- In two different CLIs run:
  - `serve -C`
  - `npm start`

# Viewing

- run `npm run serve-dist`
- open a URL displayed

This is just a simple test so far.

# Thanks

- @quasimondo scraper: https://gist.github.com/Quasimondo/30416ce22243610a9c95424e8796b008
- all @hicetnunc2000 community