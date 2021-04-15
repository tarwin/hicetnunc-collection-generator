# What the  ?

A tool for downloading the files from your Hic Et Nunc collection (https://www.hicetnunc.xyz/) and then creating thumbnails.

It should generate thumbnails for static images, videos, HTML pages, SVG and even 3D models!

What's the point? Well there will be a static site generator coming soon so you can have a nice little gallery of your collection wherever you want.

I also plan on making a "slideshow" version that you can display on a screen on something like a Rasberry Pi or even cast to a Chromecast. Here's hoping I don't run out of steam.

# The code

It's a mess. I know. Just hacking things together as quick as possible to see if it works. It does. Kinda. I hope. If you want to make it nicer please fork / pull request.

Also thanks to 

# First

- Open H=N
- Go to "Manage Assets"
- Look at your browser network panel
- Filter by `/tz`
- Find the call to something like `https://51rknuvw76.execute-api.us-east-1.amazonaws.com/dev/tz`
- Right click, Copy -> Copy Response
- Paste this into `data.json`

- Copy your TZ address into the `ownerAddress` variable at the top of `test.js`

# Requirements

- `npm install`
- serve: `npm install -g serve`
- python3
- python3: `python -m pip install ipfsapi` (IPFS API)

# Run

- `serve -C`
- `node test.js`

# Thanks

- @quasimondo scraper: https://gist.github.com/Quasimondo/30416ce22243610a9c95424e8796b008
- all @hicetnunc2000 community