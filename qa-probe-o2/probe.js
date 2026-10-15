// Usage: node probe.js <throttle> <rows> <runs> <kinds: core,switch,extra,bodies,profile> [arms: main,head,o1b]
// Env: PLAYWRIGHT = path to the playwright package (default 'playwright').
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs'); const path = require('path'); const { pathToFileURL } = require('url')
const [throttle, rows, runs, which = 'core,switch', armList = 'main,head,o1b'] = [Number(process.argv[2]), Number(process.argv[3]), Number(process.argv[4]), process.argv[5], process.argv[6]]
const ARMS = armList.split(',')
const STRUCT = process.env.STRUCTURED === '0' ? '0' : '1'
const PROBE = fs.readFileSync(path.join(__dirname, 'page-probe.js'), 'utf8')
const RES = path.join(__dirname, 'results'); fs.mkdirSync(RES, { recursive: true })
const metrics = async (cdp, gc) => { if (gc) await cdp.send('HeapProfiler.collectGarbage'); const m = (await cdp.send('Performance.getMetrics')).metrics; return Object.fromEntries(m.map((x) => [x.name, x.value])) }
const pick = (m) => ({ task: m.TaskDuration * 1000, script: m.ScriptDuration * 1000, layout: m.LayoutDuration * 1000, style: m.RecalcStyleDuration * 1000, layoutCount: m.LayoutCount, styleCount: m.RecalcStyleCount, heap: m.JSHeapUsedSize, nodes: m.Nodes, listeners: m.JSEventListeners })
const MANIFEST = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'manifest.json'), 'utf8')) } catch { return {} } })()
const sha1 = (buf) => require('crypto').createHash('sha1').update(buf).digest('hex').slice(0, 12)
const delta = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, b[k] - a[k]]))
const p95 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] : null }
const frameStats = (ts) => { const d = ts.slice(1).map((t, i) => t - ts[i]); return { n: d.length, p95: p95(d), max: d.length ? Math.max(...d) : null, dropped: d.reduce((a, x) => a + Math.max(0, Math.round(x / 16.7) - 1), 0) } }
const elements = (page) => page.evaluate(() => ({ elements: document.querySelectorAll('*').length, rows: document.querySelectorAll('[data-testid^="chat-row:"]').length }))

async function openPage(browser, arm, bodies) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await page.goto(pathToFileURL(path.join(__dirname, 'out', `${arm}${bodies ? '-bodies' : ''}.html`)).href + `#rows=${rows}&structured=${STRUCT}`)
  await page.evaluate(PROBE)
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle })
  await page.waitForTimeout(500)
  return { ctx, page, cdp, errors }
}
const open = (r) => { const end = r.frames.find((f) => f.atEnd); return { work: r.work, firstFrame: r.frames[0] && r.frames[0].t, firstFrameAtEnd: !!(r.frames[0] && r.frames[0].atEnd), firstDist: r.frames[0] && r.frames[0].dist, timeToEnd: end ? end.t : null, framesBeforeEnd: r.frames.filter((f) => !f.atEnd).length } }
async function timedOpen(page, cdp, apply) {
  const m0 = pick(await metrics(cdp))
  const r = await page.evaluate(`window.__timeToEnd(${apply}, 30000)`)
  const settle = await page.evaluate(() => window.__settle(700, 30000))
  const m1 = pick(await metrics(cdp))
  return { ...open(r), settleMs: settle.settledAt - r.t0, settledRows: settle.rows, busy: delta(m0, m1), longTasks: await page.evaluate(([a, b]) => window.__ltIn(a, b), [r.t0, settle.settledAt + 1]) }
}
async function updates(page, cdp, kind, n, gap) {
  const s0 = pick(await metrics(cdp))
  const u = await page.evaluate(`window.__updates('${kind}', ${n}, ${gap}, false)`)
  const s1 = pick(await metrics(cdp))
  const busy = delta(s0, s1)
  return { n, busyPerUpdate: busy.task / n, busy, work: u.work, workMean: u.work.reduce((a, x) => a + x, 0) / n, workP95: p95(u.work), workMax: Math.max(...u.work), frames: frameStats(u.frames), longTasks: await page.evaluate(([a, b]) => window.__ltIn(a, b), [u.t0, u.t1]), scrollTop0: u.scrollTop0, scrollTop1: u.scrollTop1, gapAtEnd: u.following }
}
// Fixed-rate twin of updates(): busy and its layout/style split per update, lag behind the source.
async function updatesAt(page, cdp, kind, n, period) {
  const s0 = pick(await metrics(cdp))
  const u = await page.evaluate(`window.__updatesAt('${kind}', ${n}, ${period})`)
  const s1 = pick(await metrics(cdp)); const busy = delta(s0, s1)
  return { n, busyPerUpdate: busy.task / n, layoutPerUpdate: busy.layout / n, stylePerUpdate: busy.style / n, scriptPerUpdate: busy.script / n, busy, work: u.work, workP95: p95(u.work), lagMax: Math.max(...u.lag), backlog: u.backlog, toFrameP95: p95(u.toFrame), frames: frameStats(u.frames), longTasks: await page.evaluate(([a, b]) => window.__ltIn(a, b), [u.t0 - 1, u.t1]), scrollTop0: u.scrollTop0, scrollTop1: u.scrollTop1, gapAtEnd: u.following }
}
async function screen(browser, arm) {
  const { ctx, page, cdp, errors } = await openPage(browser, arm)
  const out = {}
  out.mount = await timedOpen(page, cdp, '() => window.__set({ mounted: true })')
  await page.waitForTimeout(300)
  out.streamFollow = await updatesAt(page, cdp, 'stream', 20, 50)
  await settleUpdates(page)
  out.parkedAt = await page.evaluate(() => window.__park())
  out.streamParked = await updatesAt(page, cdp, 'stream', 20, 50)
  await settleUpdates(page)
  if (process.env.APPENDS !== '0') {
    await page.evaluate(() => { const s = window.__scroller(); s.scrollTop = s.scrollHeight }); await page.waitForTimeout(400)
    out.appendFollow = await updatesAt(page, cdp, 'append', 20, 50)
    await settleUpdates(page); await page.evaluate(() => window.__park())
    out.appendParked = await updatesAt(page, cdp, 'append', 20, 50)
    await settleUpdates(page)
  }
  await page.evaluate(() => window.__park())
  out.cached = await timedOpen(page, cdp, '() => window.__set({ chat: "B" })')
  await page.evaluate(() => window.__set({ mounted: false })); await page.waitForTimeout(500)
  out.small = await timedOpen(page, cdp, '() => window.__set({ mounted: true, chat: "S" })')
  out.errors = errors
  await ctx.close(); return out
}
// One diagnostic run: event-loop lag through open and switch, exact geometry, computed styles, screenshots.
async function geom(browser, arm) {
  const { ctx, page, errors } = await openPage(browser, arm)
  const out = { shots: {} }
  const lagged = (apply) => page.evaluate(`new Promise((r) => { const stop = window.__lagStart(); window.__timeToEnd(${apply}, 30000).then(() => window.__settle(700, 30000)).then(() => r(stop())) })`)
  out.openLag = await lagged('() => window.__set({ mounted: true })')
  out.geometry = await page.evaluate(() => window.__geometry())
  for (const [name, at] of [['end', 1], ['middle', 0.5], ['top', 0]]) {
    await page.evaluate((f) => { const s = window.__scroller(); s.scrollTop = Math.round((s.scrollHeight - s.clientHeight) * f) }, at)
    await page.waitForTimeout(400); const buf = await page.screenshot(); fs.writeFileSync(path.join(RES, `shot-${arm}-${name}.png`), buf); out.shots[name] = sha1(buf)
  }
  await page.evaluate(() => window.__park())
  out.switchLag = await lagged('() => window.__set({ chat: "B" })')
  out.geometryB = await page.evaluate(() => window.__geometry())
  out.errors = errors
  await ctx.close(); return out
}
// One devtools trace of open and fixed-rate streaming: renderer main-thread rendering work by kind,
// forced (inside script) vs scheduled layout, and how many layout objects each layout visited.
async function trace(browser, arm) {
  const { ctx, page, cdp } = await openPage(browser, arm)
  const events = []; cdp.on('Tracing.dataCollected', (d) => events.push(...d.value))
  const complete = new Promise((r) => cdp.once('Tracing.tracingComplete', r))
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,v8.execute', transferMode: 'ReportEvents' })
  await page.evaluate(() => performance.mark('open-start'))
  await page.evaluate(() => window.__timeToEnd(() => window.__set({ mounted: true }), 30000)); await page.evaluate(() => window.__settle(700, 30000))
  await page.evaluate(() => { performance.mark('open-end'); performance.mark('stream-start') })
  await page.evaluate("window.__updatesAt('stream', 20, 50)")
  await page.evaluate(() => performance.mark('stream-end'))
  await cdp.send('Tracing.end'); await complete; await ctx.close()
  const main = events.find((e) => e.ph === 'M' && e.name === 'thread_name' && e.args.name === 'CrRendererMain')
  const onMain = events.filter((e) => main && e.pid === main.pid && e.tid === main.tid)
  const mark = (n) => (events.find((e) => e.name === n) || {}).ts
  const spans = []; const open = {}
  for (const e of onMain) { if (e.ph === 'X') spans.push(e); else if (e.ph === 'B') (open[e.name] ||= []).push(e); else if (e.ph === 'E' && open[e.name]?.length) { const b = open[e.name].pop(); spans.push({ ...b, dur: e.ts - b.ts, args: { ...b.args, ...e.args } }) } }
  const SCRIPT = new Set(['FunctionCall', 'TimerFire', 'EvaluateScript', 'v8.callFunction', 'FireAnimationFrame', 'EventDispatch', 'RunMicrotasks'])
  const scripts = spans.filter((e) => SCRIPT.has(e.name))
  const phase = (a, b) => {
    const inPhase = spans.filter((e) => e.ts >= a && e.ts < b); const sum = {}
    for (const e of inPhase) if (['Layout', 'UpdateLayoutTree', 'PrePaint', 'Paint', 'Layerize', 'Commit', 'ParseHTML', 'HitTest'].includes(e.name) || SCRIPT.has(e.name)) { const k = e.name === 'Layout' && scripts.some((s) => s.ts <= e.ts && e.ts < s.ts + s.dur) ? 'Layout(forced)' : e.name; (sum[k] ||= { n: 0, ms: 0 }).n++; sum[k].ms += (e.dur || 0) / 1000 }
    const layouts = inPhase.filter((e) => e.name === 'Layout' && e.args?.beginData)
    const styles = inPhase.filter((e) => e.name === 'UpdateLayoutTree')
    return { sum, layoutDirtyMean: layouts.length ? layouts.reduce((x, e) => x + (e.args.beginData.dirtyObjects || 0), 0) / layouts.length : null, layoutTotalObjects: layouts.length ? Math.max(...layouts.map((e) => e.args.beginData.totalObjects || 0)) : null, styleElements: styles.reduce((x, e) => x + (e.args?.elementCount || 0), 0) }
  }
  return { open: phase(mark('open-start'), mark('open-end')), stream: phase(mark('stream-start'), mark('stream-end')) }
}
async function settleUpdates(page) { await page.evaluate(() => window.__set({ streaming: null, working: false })); await page.evaluate(() => window.__settle(500, 10000)) }

async function core(browser, arm) {
  const { ctx, page, cdp, errors } = await openPage(browser, arm)
  const out = {}
  out.mount = await timedOpen(page, cdp, '() => window.__set({ mounted: true })')
  out.memMount = { ...pick(await metrics(cdp, true)), ...(await elements(page)) }
  await page.waitForTimeout(300)
  out.streamFollow = await updates(page, cdp, 'stream', 20, 50)
  await settleUpdates(page)
  out.memStream = { ...pick(await metrics(cdp, true)), ...(await elements(page)) }
  out.parkedAt = await page.evaluate(() => window.__park())
  out.streamParked = await updates(page, cdp, 'stream', 20, 50)
  await settleUpdates(page)
  out.errors = errors
  await ctx.close(); return out
}
async function extra(browser, arm) {
  const { ctx, page, cdp, errors } = await openPage(browser, arm)
  const out = {}
  await page.evaluate(() => window.__timeToEnd(() => window.__set({ mounted: true }), 30000)); await page.evaluate(() => window.__settle(700, 30000))
  out.appendFollow = await updates(page, cdp, 'append', 20, 50)
  await page.evaluate(() => window.__settle(500, 10000))
  out.parkedAt = await page.evaluate(() => window.__park())
  out.appendParked = await updates(page, cdp, 'append', 20, 50)
  await page.evaluate(() => window.__settle(500, 10000))
  await page.evaluate(() => { const s = window.__scroller(); s.scrollTop = s.scrollHeight })
  await page.waitForTimeout(400)
  const sc0 = pick(await metrics(cdp))
  const sc = await page.evaluate('window.__scrollRun(10000, 2000, 2000)')
  const sc1 = pick(await metrics(cdp))
  out.scroll = { fast: frameStats(sc.fr.fast), slow: frameStats(sc.fr.slow), rows: sc.rows, timedOut: sc.timedOut, durMs: sc.t1 - sc.t0, busy: delta(sc0, sc1), longTasks: await page.evaluate(([a, b]) => window.__ltIn(a, b), [sc.t0, sc.t1]) }
  out.errors = errors
  await ctx.close(); return out
}
async function sw(browser, arm) {
  const { ctx, page, cdp, errors } = await openPage(browser, arm)
  const out = {}
  await page.evaluate(() => window.__timeToEnd(() => window.__set({ mounted: true }), 30000)); await page.evaluate(() => window.__settle(700, 30000))
  // Park in A first, as a reader who scrolled up and then switched.
  out.parkedAt = await page.evaluate(() => window.__park())
  out.cached = await timedOpen(page, cdp, '() => window.__set({ chat: "B" })')
  await page.evaluate(() => window.__set({ mounted: false })); await page.waitForTimeout(500)
  out.fresh = await timedOpen(page, cdp, '() => window.__set({ mounted: true, chat: "A" })')
  await page.evaluate(() => window.__set({ mounted: false })); await page.waitForTimeout(500)
  out.small = await timedOpen(page, cdp, '() => window.__set({ mounted: true, chat: "S" })')
  // Memory: 10 cached switches between the two long chats, then leaving the surface.
  await page.evaluate(() => window.__set({ chat: 'A' })); await page.evaluate(() => window.__settle(500, 30000))
  const mem = [{ at: 0, ...pick(await metrics(cdp, true)), ...(await elements(page)) }]
  for (let i = 1; i <= 10; i++) { await page.evaluate((c) => window.__set({ chat: c }), i % 2 ? 'B' : 'A'); await page.evaluate(() => window.__settle(300, 30000)); if (i % 5 === 0) mem.push({ at: i, ...pick(await metrics(cdp, true)), ...(await elements(page)) }) }
  await page.evaluate(() => window.__set({ mounted: false })); await page.waitForTimeout(500)
  mem.push({ at: 'left', ...pick(await metrics(cdp, true)), ...(await elements(page)) })
  out.mem = mem
  out.errors = errors
  await ctx.close(); return out
}
// Following at the end of P with scroll anchoring off (the iOS stand-in): an older page lands above.
// Every frame for 1.5 s is sampled at paint time; any frame not at the end is a frame painted off it.
async function prepend(browser, arm) {
  const { ctx, page, cdp, errors } = await openPage(browser, arm)
  await page.addStyleTag({ content: '* { overflow-anchor: none !important; }' })
  const out = {}
  out.open = await timedOpen(page, cdp, '() => window.__set({ mounted: true, chat: "P" })')
  await page.waitForTimeout(300)
  const r = await page.evaluate("new Promise((resolve) => setTimeout(() => { const t0 = performance.now(); const p = window.__paintFrames(t0, 1500, null); const work = window.__tick('prepend', 0); p.then((frames) => resolve({ t0, frames, work })) }, 0))")
  const off = r.frames.filter((f) => !f.atEnd)
  out.landing = { work: r.work, frames: r.frames.length, offEnd: off.length, maxDist: Math.max(0, ...off.map((f) => f.dist ?? 0)), firstOff: off.slice(0, 5) }
  out.rowsAfter = (await elements(page)).rows
  out.errors = errors
  await ctx.close(); return out
}
async function bodies(browser, arm) {
  const { ctx, page, cdp, errors } = await openPage(browser, arm, true)
  const out = {}
  await page.evaluate(() => { globalThis.__bodies = [] })
  await page.evaluate(() => window.__timeToEnd(() => window.__set({ mounted: true }), 30000)); await page.evaluate(() => window.__settle(700, 30000))
  out.mountBodies = await page.evaluate(() => globalThis.__bodies.length)
  for (const [name, kind, park] of [['streamFollow', 'stream', false], ['appendFollow', 'append', false], ['streamParked', 'stream', true], ['appendParked', 'append', true]]) {
    if (park) await page.evaluate(() => window.__park())
    await page.evaluate(() => { globalThis.__bodies = [] })
    const u = await page.evaluate(`window.__updates('${kind}', 10, 60, false)`)
    out[name] = u.bodies.map((ids) => ({ n: ids.length, distinct: new Set(ids).size, sample: [...new Set(ids)].slice(0, 6) }))
    await settleUpdates(page)
  }
  out.errors = errors
  await ctx.close(); return out
}
async function profile(browser, arm) {
  const out = {}
  for (const scen of ['mount', 'stream']) {
    const { ctx, page, cdp } = await openPage(browser, arm)
    if (scen === 'stream') { await page.evaluate(() => window.__timeToEnd(() => window.__set({ mounted: true }), 30000)); await page.evaluate(() => window.__settle(700, 30000)) }
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start')
    if (scen === 'mount') { await page.evaluate(() => window.__timeToEnd(() => window.__set({ mounted: true }), 30000)); await page.evaluate(() => window.__settle(700, 30000)) }
    else await page.evaluate("window.__updates('stream', 20, 50, false)")
    const { profile: prof } = await cdp.send('Profiler.stop')
    const src = fs.readFileSync(path.join(__dirname, 'out', `${arm}.js`), 'utf8').split('\n')
    const modAt = []; let cur = '?'; for (let i = 0; i < src.length; i++) { const m = src[i].match(/^ {2}\/\/ (\S+)$/); if (m) cur = m[1].replace(/.*node_modules\//, '').replace(/.*arms\/[^/]+\//, ''); modAt[i] = cur }
    const dt = {}; prof.samples.forEach((id, i) => { dt[id] = (dt[id] || 0) + (prof.timeDeltas[i] || 0) })
    const byFn = {}, byMod = {}; let total = 0
    for (const n of prof.nodes) { const t = (dt[n.id] || 0) / 1000; total += t; const cf = n.callFrame; const mod = cf.url.endsWith(`${arm}.js`) ? modAt[cf.lineNumber] : (cf.url || cf.functionName); const k = `${cf.functionName || '(anon)'} @ ${mod}`; byFn[k] = (byFn[k] || 0) + t; byMod[mod] = (byMod[mod] || 0) + t }
    const top = (o, k) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([name, v]) => `${v.toFixed(0).padStart(6)} ms  ${name}`)
    out[scen] = { total, byModule: top(byMod, 15), byFunction: top(byFn, 20) }
    await ctx.close()
  }
  return out
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const fns = { core, switch: sw, extra, bodies, profile, prepend, screen, geom, trace }
  for (let run = 1; run <= runs; run++) {
    const order = run % 2 ? ARMS : [...ARMS].reverse()
    for (const kind of which.split(',')) {
      for (const arm of order) {
        const t = Date.now()
        const r = { arm, rows, throttle, run, structured: STRUCT, browser: browser.version(), variant: MANIFEST[arm] ?? null, ...(await fns[kind](browser, arm)) }
        fs.writeFileSync(path.join(RES, `${kind}-t${throttle}-r${rows}-s${STRUCT}-${arm}-${run}.json`), JSON.stringify(r))
        const brief = kind === 'core' ? `mount toEnd=${r.mount.timeToEnd?.toFixed(0)} firstAtEnd=${r.mount.firstFrameAtEnd} stream busy/upd=${r.streamFollow.busyPerUpdate.toFixed(1)} p95=${r.streamFollow.workP95.toFixed(1)}` : kind === 'switch' ? `cached toEnd=${r.cached.timeToEnd?.toFixed(0)} fresh=${r.fresh.timeToEnd?.toFixed(0)} small=${r.small.timeToEnd?.toFixed(0)}` : kind === 'prepend' ? `landing offEnd=${r.landing.offEnd}/${r.landing.frames} maxDist=${r.landing.maxDist}` : kind === 'screen' ? `open=${r.mount.timeToEnd?.toFixed(0)} cached=${r.cached.timeToEnd?.toFixed(0)} stream busy/upd=${r.streamFollow.busyPerUpdate.toFixed(1)} parked=${r.streamParked.busyPerUpdate.toFixed(1)}` : ''
        console.log(`${kind} t${throttle} r${rows} ${arm} #${run} ${brief} errors=${(r.errors || []).length} (${((Date.now() - t) / 1000).toFixed(0)}s)`)
      }
    }
  }
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
