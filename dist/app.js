window.__onGCastApiAvailable = (isAvailable) => {
  console.log('window.castEnabled', isAvailable)
  window.castEnabled = isAvailable
}

// one minute
const presentationTimePerObject = 60 * 1000;

var VueMasonryPlugin = window["vue-masonry-plugin"].VueMasonryPlugin
Vue.use(VueMasonryPlugin)

async function getAddressInfo(address) {
  const res = await fetch(`https://api.tzkt.io/v1/accounts/${address}/metadata`)
  return await res.json()
}

// inc, ex
function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min
}

const mimeTypes = [
  { type: 'image', mime: ['image/gif','image/png','image/jpeg','image/webp','image/tiff','image/bmp'] },
  { type: 'video', mime: ['video/quicktime','video/mp4','video/webm','video/ogg'] },
  { type: 'html', mime: ['application/x-directory'] },
  { type: 'gltf', mime: ['model/gltf+json', 'model/gltf-binary'] },
  { type: 'html', mime: ['application/x-directory', 'model/gltf-binary'] },
  { type: 'svg', mime: ['image/svg+xml'] },
  { type: 'audio', mime: ['audio/mpeg', 'audio/ogg'] },
  { type: 'pdf', mime: ['application/pdf'] },
]

var presTo = null

var app = new Vue({
  el: '#app',
  components: {
    'pinch-zoom': vuePinchZoom
  },
  data: {
    castApplicationId: 'A564A115',
    canCast: false,
    isCasting: false,
    loading: true,
    owner: {},
    config: {},
    thumbs: [],
    thumbPath: '',
    isDark: false,
    currentObject: null,
    currentCreator: null,
    mainScroll: 0,
    isPresenting: false,
    isFullscreen: false,
    isCasting: false,
    showList: 'collected',
    data: {},
    filterType: '',
  },
  mounted() {
    fetch('./data.json')
    .then((res) => {
      return res.json()
    })
    .then(async (json) => {
      this.data = json

      this.config = this.data.config
      this.thumbPath = `${this.config.thumbnail.path}`

      this.owner = await getAddressInfo(this.data.owner.address)
      this.owner.address = this.data.owner.address
      
      this.data.collectedObjects.reverse()
      this.data.createdObjects.reverse()

      // add url removing ipfs://
      this.data.collectedObjects.forEach(obj => {
        obj.url = `https://cloudflare-ipfs.com/ipfs/${obj.artifactUri.substr(7)}`
      })
      this.data.createdObjects.forEach(obj => {
        obj.url = `https://cloudflare-ipfs.com/ipfs/${obj.artifactUri.substr(7)}`
      })

      this.loading = false

      const objIdMatch = window.location.hash.match(/obj=([0-9]+)/)
      if (objIdMatch) {
        this.showObj(parseInt(objIdMatch[1]))
      }
      if (window.location.hash === '#play') {
        this.startPresentation()
      }

      this.$watch('isCasting', val => {
        console.log('isCasting', val)
      })
      this.$watch('canCast', val => {
        console.log('canCast', val)
      })

      this.checkVideoPlaying()

      this.checkCaster()
      // this.setupMasonry()

      this.$watch('showList', this.checkVideoPlaying)
      this.$watch('filterType', this.checkVideoPlaying)
    })

    document.addEventListener("fullscreenchange", (event) => {
      if (!document.fullscreenElement) {
        this.isFullscreen = false
        this.stopPresentation()
      }
    })

    this.$watch('isDark', (isDark) => {
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    })
    if (window.matchMedia &&  window.matchMedia('(prefers-color-scheme: dark)').matches) {
      this.isDark = true
    }
  },
  methods: {
    checkVideoPlaying() {
      // make sure videos are playig that are displayed?
      this.$nextTick(() => {
        for (let el of document.getElementsByTagName('video')) {
          if (this.isInViewport(el)) {
            el.play()
          }
        }
      })
    },
    stopAllVideos() {
      for (let el of document.getElementsByTagName('video')) {
        el.pause()
      }
    },
    isInViewport(elem) {
      const bounding = elem.getBoundingClientRect()
      return (
        bounding.top >= 0 &&
        bounding.left >= 0 &&
        bounding.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        bounding.right <= (window.innerWidth || document.documentElement.clientWidth)
      )
    },
    viewHandler(e) {
      const el = e.target.element
      if (el.nodeName === 'VIDEO') {
        if (e.type === 'enter') {
          el.play()
        } else if (e.type === 'exit') {
          el.pause()
        }
      }
    },
    async showObj(objectId) {
      this.stopAllVideos()

      this.mainScroll = window.scrollY
      document.body.style.position = 'fixed';
      document.body.style.top = `-${window.scrollY}px`;
      // document.body.style.overflow = 'hidden'

      const obj = this.objects.find(o => o.id === objectId)
      this.currentObject = obj
      this.currentCreator = null
      window.location.hash = `obj=${objectId}`
      //
      // if (obj.mime.indexOf('audio') === 0) {
      //   this.$nextTick(() => {
      //     var wavesurfer = WaveSurfer.create({
      //       container: '#waveform',
      //       waveColor: '#000',
      //       progressColor: '#fff'
      //     })
      //     wavesurfer.load(`https://${obj.cid}.ipfs.infura-ipfs.io/`)
      //   })
      // }
      try {
        this.currentCreator = await getAddressInfo(obj.creatorAddress)
      } catch(e) {}
    },
    closeObj() {
      document.querySelector('body').style.overflow = 'auto'
      this.currentObject = null
      window.location.hash = ''
      this.$nextTick(() => {
        setTimeout(() => {
          document.body.style.position = '';
          document.body.style.top = '';
          window.scrollTo({ top: this.mainScroll })
        }, 100)
        this.checkVideoPlaying()
      })
    },
    miniAddress(str) {
      return `${str.substr(0, 4)}...${str.substr(-4)}`
    },
    goFull() {
      this.isFullscreen = true
      document.querySelector("#full-item").requestFullscreen();
    },
    getRandomObjectId() {
      return this.objects[getRandomInt(0, this.objects.length)].id
    },
    presKeyEvent(e) {
      if(e.keyCode === 32) {
        this.nextPres()
      }
    },
    startPresentation() {
      this.stopAllVideos()
      
      this.isPresenting = true
      this.isFullscreen = true
      this.showObj(this.currentObject ? this.currentObject.id : this.getRandomObjectId())
      this.$nextTick(() => {
        this.goFull()
        presTo = setTimeout(this.nextPres, presentationTimePerObject)
        window.addEventListener('keydown', this.presKeyEvent)
      })
    },
    nextPres() {
      this.showObj(this.getRandomObjectId())
      if (presTo) clearTimeout(presTo)
      presTo = null
      presTo = setTimeout(this.nextPres, presentationTimePerObject)
    },
    stopPresentation() {
      window.removeEventListener('keydown', this.presKeyEvent)
      this.isPresenting = false
      if (presTo) clearTimeout(presTo)
      presTo = null
    },
    startCaster() {
      this.canCast = true
      window.cast.framework.CastContext.getInstance().setOptions({
        receiverApplicationId: this.castApplicationId,
        autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
      })

      var context = window.cast.framework.CastContext.getInstance();
      context.addEventListener(
        cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        (event) => {
          switch (event.sessionState) {
            case cast.framework.SessionState.SESSION_STARTED:
            case cast.framework.SessionState.SESSION_RESUMED:
              this.isCasting = true
              break
            case cast.framework.SessionState.SESSION_ENDED:
              this.isCasting = false
              // Update locally as necessary
              break
          }
        })
    },
    checkCaster() {
      if (window.castEnabled) {
        this.startCaster()
      } else {
        window.__onGCastApiAvailable = (isAvailable) => {
          console.log('cast', isAvailable)
          if (isAvailable) {
            this.startCaster()
          }
        };
      }
    },
    switchCollection() {
      this.showList = this.showList === 'collected' ? 'created' : 'collected'
    },
    doMasonry() {
      let grids = [...document.querySelectorAll('.grid--masonry')]

      if (grids.length && getComputedStyle(grids[0]).gridTemplateRows !== 'masonry') {
        grids = grids.map(grid => ({
          _el: grid, 
          gap: parseFloat(getComputedStyle(grid).gridRowGap), 
          items: [...grid.childNodes].filter(c => c.nodeType === 1 && +getComputedStyle(c).gridColumnEnd !== -1), 
          ncol: 0, 
          mod: 0
        }));

        grids.forEach(grid => {
          /* get the post relayout number of columns */
          let ncol = getComputedStyle(grid._el).gridTemplateColumns.split(' ').length;
    
          /* if the number of columns has changed */
          if (grid.ncol !== ncol || true) {
            /* update number of columns */
            grid.ncol = ncol;
    
            /* revert to initial positioning, no margin */
            grid.items.forEach(c => c.style.removeProperty('margin-top'));
    
            /* if we have more than one column */
            if (grid.ncol > 1) {
              grid.items.slice(ncol).forEach((c, i) => {
                let prev_fin = grid.items[i].getBoundingClientRect().bottom /* bottom edge of item above */,
                curr_ini = c.getBoundingClientRect().top /* top edge of current item */;
    
                c.style.marginTop = `${prev_fin + grid.gap - curr_ini + 50}px`;
              });
            }
          }
        });
      }
    },
    setupMasonry() {      
      addEventListener('load', e => {
        this.doMasonry(); /* initial load */
        addEventListener('resize', this.doMasonry(), false) /* on resize */
      }, false); 
    }
  },
  computed: {
    objects() {
      const objects = this.showList === 'collected' ?
        this.data.collectedObjects :
        this.data.createdObjects
      if (this.filterType) {
        if (this.filterType === 'still') {
          return objects.filter(o => o.mime !== 'image/gif' && o.mime.indexOf('image/') === 0)
        }
        return objects.filter(o => o.mime.indexOf(this.filterType) === 0)
      }
      return objects
    },
    currentObjectType() {
      if (!this.currentObject) return null
      const mime = mimeTypes.find(m => m.mime.includes(this.currentObject.mime))
      return mime && mime.type || null
    }
  }
})