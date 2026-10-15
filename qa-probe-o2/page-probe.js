// Injected into each page: paint-time sampler, frame recorder, settle wait, long tasks.
window.__lt = []
new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ s: e.startTime, d: e.duration }) }).observe({ type: 'longtask', buffered: true })
const ROW = '[data-testid^="chat-row:"]'
let scrollerCache = null
window.__scroller = () => {
  if (scrollerCache && scrollerCache.isConnected) return scrollerCache
  const anchor = document.querySelector(ROW)
  for (let d = anchor && anchor.parentElement; d; d = d.parentElement) { const o = getComputedStyle(d).overflowY; if ((o === 'auto' || o === 'scroll') && d.clientHeight > 0) return (scrollerCache = d) }
  return null
}
// At the end: no gap below the content, and (when a newest row is named) that row drawn and in view.
window.__view = () => {
  const s = window.__scroller(); if (!s) return null
  const dist = Math.round(s.scrollHeight - s.clientHeight - s.scrollTop)
  const id = window.__lastId()
  let shown = true
  if (id !== null) {
    const el = document.querySelector(`[data-testid="chat-row:${CSS.escape(id)}"]`)
    const r = s.getBoundingClientRect(); const b = el && el.getBoundingClientRect()
    shown = !!b && b.bottom <= r.bottom + 2 && b.bottom > r.top
  }
  return { dist, atEnd: dist <= 2 && shown }
}
// Paint-time frames (a ResizeObserver created after the app's fires right before paint), until done(frame) or maxMs.
window.__paintFrames = (t0, maxMs, done) => new Promise((resolve) => {
  const out = []
  const dummy = document.createElement('div'); dummy.style.cssText = 'position:fixed;left:0;top:0;height:1px;width:1px'; document.body.appendChild(dummy)
  let w = 1, stop = false
  const ro = new ResizeObserver(() => {
    const v = window.__view(); const f = { t: performance.now() - t0, ...(v || { dist: null, atEnd: false }) }
    out.push(f)
    if ((done && done(f)) || f.t > maxMs) { stop = true; ro.disconnect(); dummy.remove(); resolve(out) }
  })
  ro.observe(dummy)
  const tick = () => { if (!stop) { w = w === 1 ? 2 : 1; dummy.style.width = w + 'px'; requestAnimationFrame(tick) } }
  requestAnimationFrame(tick)
})
// Mount/switch: start sampling, apply from a page task, return frames until the first frame at the end.
window.__timeToEnd = (apply, maxMs) => new Promise((resolve) => setTimeout(() => { const t0 = performance.now(); const p = window.__paintFrames(t0, maxMs, (f) => f.atEnd); const work = apply(); p.then((frames) => resolve({ t0, frames, work })) }, 0))
// Settled: drawn rows and content height unchanged for quietMs.
window.__settle = (quietMs, capMs) => new Promise((resolve) => {
  const t0 = performance.now(); let sig = '', since = t0
  const poll = () => {
    const s = window.__scroller(); const now = performance.now()
    const cur = document.querySelectorAll(ROW).length + ':' + (s ? s.scrollHeight : 0)
    if (cur !== sig) { sig = cur; since = now }
    if (now - since >= quietMs || now - t0 > capMs) resolve({ settledAt: since, waited: now - t0, capped: now - t0 > capMs, rows: document.querySelectorAll(ROW).length })
    else setTimeout(poll, 50)
  }
  poll()
})
window.__ltIn = (a, b) => window.__lt.filter((e) => e.s >= a && e.s < b)
window.__frames = () => { const ts = []; let on = true; const f = (t) => { ts.push(t); if (on) requestAnimationFrame(f) }; requestAnimationFrame(f); return () => { on = false; return ts } }
// Park the reader mid-transcript: a move up, which the page's owner reads as the reader's.
window.__park = () => new Promise((resolve) => { const s = window.__scroller(); s.scrollTop = Math.floor((s.scrollHeight - s.clientHeight) / 2); setTimeout(() => resolve(s.scrollTop), 400) })
// n updates of `kind` ('stream' | 'append') from page tasks, gapMs apart. Each update's synchronous
// work (render + commit + layout effects) is timed; bodies counted when the build is instrumented.
window.__updates = (kind, n, gapMs, paint) => new Promise((resolve) => {
  const s = window.__scroller(); const top0 = s.scrollTop
  const stopFrames = window.__frames(); const t0 = performance.now(); const work = []; const bodies = []
  let doneWatching = false
  const watch = paint ? window.__paintFrames(t0, 1e9, () => doneWatching) : Promise.resolve([])
  let k = 0
  const next = () => {
    if (k < n) { globalThis.__bodies = globalThis.__bodies ? [] : undefined; work.push(window.__tick(kind, k++)); if (globalThis.__bodies) bodies.push(globalThis.__bodies.slice()); setTimeout(next, gapMs) }
    else setTimeout(async () => { const t1 = performance.now(); doneWatching = true; const frames = stopFrames(); const pf = await watch; resolve({ t0, t1, frames, work, bodies, paint: pf, scrollTop0: top0, scrollTop1: s.scrollTop, following: s.scrollHeight - s.clientHeight - s.scrollTop }) }, 300)
  }
  setTimeout(next, gapMs)
})
// Steady scroll from the end to the top and back (speed px/s), then a slow drag up and down near the end.
window.__scrollRun = (speed, slowSpeed, slowMs) => new Promise((resolve) => {
  const s = window.__scroller(); const t0 = performance.now(); const fr = { fast: [], slow: [] }
  let phase = 'up', pStart = t0, from = s.scrollTop
  const f = (now) => {
    fr[phase === 'up' || phase === 'down' ? 'fast' : 'slow'].push(now)
    const dt = (now - pStart) / 1000; const max = s.scrollHeight - s.clientHeight
    if (phase === 'up') { const y = Math.max(0, from - speed * dt); s.scrollTop = y; if (y <= 0) { phase = 'down'; pStart = now } }
    else if (phase === 'down') { const y = Math.min(max, speed * dt); s.scrollTop = y; if (y >= max - 1) { phase = 'slowUp'; pStart = now; from = s.scrollTop } }
    else if (phase === 'slowUp') { s.scrollTop = from - slowSpeed * dt; if (now - pStart >= slowMs) { phase = 'slowDown'; pStart = now; from = s.scrollTop } }
    else if (phase === 'slowDown') { s.scrollTop = from + slowSpeed * dt; if (now - pStart >= slowMs) phase = 'done' }
    if (phase === 'done' || now - t0 > 300000) { resolve({ t0, t1: performance.now(), fr, timedOut: phase !== 'done', rows: document.querySelectorAll(ROW).length }); return }
    requestAnimationFrame(f)
  }
  requestAnimationFrame(f)
})
// Fixed-rate source (decider2 §5.1): update k is due at t0 + k*period and is delivered in order even
// when late (never dropped or coalesced). Records due/applied/next-frame times and the final backlog.
window.__updatesAt = (kind, n, period) => new Promise((resolve) => {
  const s = window.__scroller(); const top0 = s.scrollTop
  const stopFrames = window.__frames(); const t0 = performance.now() + period; const log = []
  let k = 0
  const run = () => {
    const due = t0 + k * period; const applied = performance.now(); const work = window.__tick(kind, k)
    const entry = { due, applied, work }; log.push(entry); requestAnimationFrame((f) => { entry.frame = f })
    k += 1
    if (k < n) setTimeout(run, Math.max(0, t0 + k * period - performance.now()))
    else requestAnimationFrame(() => requestAnimationFrame(() => { const t1 = performance.now(); resolve({ t0, t1, frames: stopFrames(), work: log.map((e) => e.work), lag: log.map((e) => e.applied - e.due), backlog: log[n - 1].applied - log[n - 1].due, toFrame: log.map((e) => (e.frame ?? t1) - e.applied), scrollTop0: top0, scrollTop1: s.scrollTop, following: s.scrollHeight - s.clientHeight - s.scrollTop }) }))
  }
  setTimeout(run, period)
})
// Event-loop lag while an open/switch runs: a 4 ms ping chain; the largest gap is how long input waits.
window.__lagStart = () => { const lags = []; let last = performance.now(); let on = true; const ping = () => { const now = performance.now(); lags.push(now - last - 4); last = now; if (on) setTimeout(ping, 4) }; setTimeout(ping, 4); return () => { on = false; return { max: Math.max(0, ...lags), over50: lags.filter((x) => x >= 50).length } } }
// Exact geometry: content height, drawn rows and a signature of every row's top and height.
window.__geometry = () => {
  const s = window.__scroller(); const rows = [...document.querySelectorAll(ROW)]; const content = s.firstElementChild
  let h = 0; for (const r of rows) h = (h * 31 + r.offsetTop * 7 + r.offsetHeight) % 1000000007
  return { scrollHeight: s.scrollHeight, rows: rows.length, signature: h, contentDisplay: getComputedStyle(content).display, rowContain: rows[0] ? getComputedStyle(rows[0]).contain : null }
}
