const fs = require('fs')

const all = JSON.parse(fs.readFileSync('./fill.json', { encoding: 'utf-8' }))

const stats = {
  'MISSING': 0,
  'TOTAL': 0,
}
all.forEach(o => {
  const mime = o.formats && o.formats[0] && o.formats[0].mimeType
  if (mime) {
    if (!stats[mime]) {
      stats[mime] = 0
    }
    stats[mime]++
  } else {
    stats['MISSING']++
  }
  stats['TOTAL']++
})

const statsAgg = {}
Object.keys(stats).forEach(k => {
  const a = k.split('/')
  if (!statsAgg[a[0]]) {
    statsAgg[a[0]] = 0
  }
  statsAgg[a[0]] += stats[k]
})

console.log(stats)
console.log(statsAgg)