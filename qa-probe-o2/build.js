// Builds every arm under ./arms/<arm>/ twice: timing (no instrumentation) and bodies (body counter).
const { esbuild, options } = require('./bundle-config')
const fs = require('fs'); const path = require('path')
const ARMS = (process.env.ARMS || 'main,head,o1b').split(',')
const crypto = require('crypto')
const ROWS = '[data-o1="page"] > div > [data-testid^="chat-row:"]'
const BLOCK = '[data-o1="page"] > div { display: block !important; }'
// Screening variants of the o1b page list (decider2 §5.2); A is O1 unchanged.
const VARIANTS = { A: '', B: BLOCK, C: `${ROWS} { contain: layout style; }`, D: `${BLOCK} ${ROWS} { contain: layout style; }`, E: `${BLOCK} ${ROWS} { contain: content; }` }
// Prototype arms (decider3): block flow on the rows' actual parent, Q6's wrapper (first child of the content).
const WRAPPER_BLOCK = '[data-o1="page"] > div > div:first-child { display: block !important; }'
const ARM_CSS = { p1: WRAPPER_BLOCK, p2: WRAPPER_BLOCK, p3: WRAPPER_BLOCK }
const manifest = {}
const page = (name, js, css) => {
  fs.writeFileSync(path.join(__dirname, 'out', `${name}.html`), `<!doctype html><html><head><meta name="viewport" content="width=390"><style>${css}</style></head><body style="margin:0;background:#111"><div id="root" style="height:844px;width:390px;display:flex"></div><script src="${js}.js"></script></body></html>`)
  manifest[name] = crypto.createHash('sha1').update(fs.readFileSync(path.join(__dirname, 'out', `${js}.js`))).update(css).digest('hex').slice(0, 12)
}
;(async () => {
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true })
  for (const arm of ARMS) {
    const root = path.join(__dirname, 'arms', arm).split(path.sep).join('/')
    const src = fs.readFileSync(path.join(__dirname, 'app.jsx'), 'utf8').replaceAll('ARMNAME', arm).replaceAll('ARMROOT', root)
    const entry = path.join(__dirname, `app-${arm}.jsx`); fs.writeFileSync(entry, src)
    for (const bodies of [false, true]) {
      const name = arm + (bodies ? '-bodies' : '')
      await esbuild.build(options(entry, path.join(__dirname, 'out', `${name}.js`), bodies))
      page(name, name, ARM_CSS[arm] ?? '')
      if (arm === 'o1b') for (const [v, css] of Object.entries(VARIANTS)) page(`o1b-${v}${bodies ? '-bodies' : ''}`, name, css)
      console.log('built', name)
    }
  }
  fs.writeFileSync(path.join(__dirname, 'out', 'manifest.json'), JSON.stringify(manifest, null, 1))
})().catch((e) => { console.log((e.errors || [e]).map((x) => (x.text || x.message) + ' @ ' + (x.location && x.location.file + ':' + x.location.line)).join('\n')); process.exit(1) })
