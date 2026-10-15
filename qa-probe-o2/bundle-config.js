// Shared esbuild config: real RN Web + real mobile sources from each arm; only native-only modules are stubbed.
// Env: MOBILE = a mobile/ dir with node_modules installed (the O1 worktree's). Arms are source exports
// (mobile/src + src/shared) under ./arms/<arm>/, resolved against MOBILE's node_modules.
const path = require('path')
const MOBILE = process.env.MOBILE
if (!MOBILE) throw new Error('set MOBILE to the mobile/ dir with node_modules')
const W = path.join(MOBILE, 'node_modules')
const esbuild = require(path.join(W, 'esbuild'))
const fs = require('fs')
const STUB = (process.env.STUBS || 'lucide-react-native').split(',').filter(Boolean)
const iconNames = () => {
  const names = new Set()
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(tsx?|jsx?)$/.test(e.name)) { const s = fs.readFileSync(p, 'utf8'); for (const m of s.matchAll(/import \{([^}]*)\} from 'lucide-react-native'/g)) for (const part of m[1].split(',')) { const n = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n) } } } }
  walk(path.join(__dirname, 'arms'))
  return [...names]
}
const esc = (x) => x.replace(/[/.\-]/g, (m) => '\\' + m)
const stubPlugin = { name: 'stub', setup(b) {
  if (!STUB.length) return
  b.onResolve({ filter: new RegExp('^(' + STUB.map(esc).join('|') + ')($|/)') }, (a) => ({ path: a.path, namespace: 'stub' }))
  // Named exports must be real: esbuild's CJS interop copies own keys only. Icons draw nothing here.
  const names = iconNames()
  b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'const Icon = () => null; export default Icon; ' + names.map((n) => `export const ${n} = Icon;`).join(' '), loader: 'js' }))
} }
// Instrumented builds only: count message-body executions. Product source is untouched on disk.
const bodiesPlugin = { name: 'bodies', setup(b) {
  b.onLoad({ filter: /MobileNativeChatMessage\.tsx$/ }, (a) => {
    const src = fs.readFileSync(a.path, 'utf8')
    const out = src.replace(/(function MobileNativeChatMessageImpl\([\s\S]*?\}\): React\.JSX\.Element \{)/, '$1 globalThis.__bodies?.push(message.id);')
    if (out === src) throw new Error('body counter: MobileNativeChatMessageImpl signature not found in ' + a.path)
    return { contents: out, loader: 'tsx' }
  })
} }
// Marks the page list's ScrollView so variant CSS can target its content; no-op for arms without it.
const pagePlugin = { name: 'page-marker', setup(b) {
  // The page's scroller is O1's list or, from Q6 on, the page scroll component it renders.
  b.onLoad({ filter: /MobileNativeChatPage(List|Scroll)\.tsx$/ }, (a) => {
    const src = fs.readFileSync(a.path, 'utf8'); const out = src.replace(/<ScrollView(?=\s)/, "<ScrollView dataSet={{ o1: 'page' }}")
    if (out === src && a.path.endsWith('Scroll.tsx')) throw new Error('page marker: <ScrollView not found in ' + a.path)
    return { contents: out, loader: 'tsx' }
  })
} }
const options = (entry, outfile, bodies) => ({
  entryPoints: [entry], bundle: true, platform: 'browser', format: 'iife', outfile, jsx: 'automatic', metafile: true,
  plugins: bodies ? [stubPlugin, pagePlugin, bodiesPlugin] : [stubPlugin, pagePlugin],
  banner: { js: "var process = { env: { NODE_ENV: 'production', EXPO_OS: 'web' }, platform: 'browser' };" },
  alias: { 'react-native': path.join(W, 'react-native-web'), react: path.join(W, 'react'), 'react-dom': path.join(W, 'react-dom') },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis', 'process.env.EXPO_OS': '"web"' }, logLevel: 'error',
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js', '.jsx', '.mjs'],
  nodePaths: [W], loader: { '.png': 'dataurl', '.ttf': 'dataurl' }
})
module.exports = { MOBILE, W, esbuild, options }
