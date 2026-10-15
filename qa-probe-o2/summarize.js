// node summarize.js [filterRegex] -> per arm, per case: mean and p95 across runs.
const fs = require('fs'); const path = require('path')
const RES = path.join(__dirname, 'results'); const re = new RegExp(process.argv[2] || '.')
const files = fs.readdirSync(RES).filter((f) => f.endsWith('.json') && re.test(f))
const groups = {}
for (const f of files) { const r = JSON.parse(fs.readFileSync(path.join(RES, f), 'utf8')); const kind = f.split('-')[0]; const key = `${kind} t${r.throttle} r${r.rows} s${r.structured}`; ((groups[key] ||= {})[r.arm] ||= []).push(r) }
const mean = (xs) => xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : NaN
const p95 = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] : NaN }
const f1 = (x) => (x == null || Number.isNaN(x) ? '-' : Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1))
const mp = (xs) => `${f1(mean(xs.filter((x) => x != null)))} / ${f1(p95(xs))}`
const longest = (lt) => lt.reduce((a, e) => Math.max(a, e.d), 0)
const rowsOut = []
const add = (key, arm, label, val) => rowsOut.push(`| ${key} | ${arm} | ${label} | ${val} |`)
for (const [key, arms] of Object.entries(groups).sort()) {
  for (const [arm, rs] of Object.entries(arms).sort()) {
    const n = rs.length
    const openRows = (name, o) => {
      add(key, arm, `${name}: first frame at newest, ms (mean / p95, n=${n})`, mp(o.map((x) => x.timeToEnd)))
      add(key, arm, `${name}: runs whose first painted frame was at newest`, `${o.filter((x) => x.firstFrameAtEnd).length}/${n}`)
      add(key, arm, `${name}: frames painted off newest (max)`, Math.max(...o.map((x) => x.framesBeforeEnd)))
      add(key, arm, `${name}: first frame gap at end px (max)`, Math.max(...o.map((x) => x.firstDist ?? Infinity)))
      add(key, arm, `${name}: sync update work ms (mean / p95)`, mp(o.map((x) => x.work)))
      add(key, arm, `${name}: main-thread busy ms (mean / p95)`, mp(o.map((x) => x.busy.task)))
      add(key, arm, `${name}: longest long task ms (mean / p95)`, mp(o.map((x) => longest(x.longTasks))))
      add(key, arm, `${name}: rows drawn after settle`, `${Math.min(...o.map((x) => x.settledRows))}-${Math.max(...o.map((x) => x.settledRows))}`)
    }
    const updRows = (name, u) => {
      add(key, arm, `${name}: busy per update ms (mean / p95 over runs)`, mp(u.map((x) => x.busyPerUpdate)))
      add(key, arm, `${name}: update work ms, per-run p95 (mean / p95)`, mp(u.map((x) => x.workP95)))
      add(key, arm, `${name}: update work max ms`, f1(Math.max(...u.map((x) => x.workMax))))
      add(key, arm, `${name}: tasks >=50 ms (total over runs)`, u.reduce((a, x) => a + x.longTasks.filter((e) => e.d >= 50).length, 0))
      add(key, arm, `${name}: frame p95 ms (mean / p95)`, mp(u.map((x) => x.frames.p95)))
      add(key, arm, `${name}: dropped frames (mean)`, f1(mean(u.map((x) => x.frames.dropped))))
      add(key, arm, `${name}: scrollTop moved px (max abs)`, f1(Math.max(...u.map((x) => Math.abs(x.scrollTop1 - x.scrollTop0)))))
      add(key, arm, `${name}: gap at end after px (max)`, f1(Math.max(...u.map((x) => x.gapAtEnd))))
    }
    if (key.startsWith('core')) { openRows('open', rs.map((r) => r.mount)); updRows('stream following', rs.map((r) => r.streamFollow)); updRows('stream parked', rs.map((r) => r.streamParked)); add(key, arm, 'mem after mount: heap MB / elements / listeners', `${f1(mean(rs.map((r) => r.memMount.heap / 1e6)))} / ${f1(mean(rs.map((r) => r.memMount.elements)))} / ${f1(mean(rs.map((r) => r.memMount.listeners)))}`) }
    if (key.startsWith('switch')) { openRows('cached switch', rs.map((r) => r.cached)); openRows('fresh switch', rs.map((r) => r.fresh)); openRows('40-row open', rs.map((r) => r.small)); for (const at of [0, 5, 10, 'left']) add(key, arm, `mem at ${at}: heap MB / elements / listeners`, `${f1(mean(rs.map((r) => r.mem.find((m) => m.at === at).heap / 1e6)))} / ${f1(mean(rs.map((r) => r.mem.find((m) => m.at === at).elements)))} / ${f1(mean(rs.map((r) => r.mem.find((m) => m.at === at).listeners)))}`) }
    if (key.startsWith('extra')) { updRows('append following', rs.map((r) => r.appendFollow)); updRows('append parked', rs.map((r) => r.appendParked)); add(key, arm, 'scroll fast frame p95 ms (mean / p95)', mp(rs.map((r) => r.scroll.fast.p95))); add(key, arm, 'scroll slow frame p95 ms (mean / p95)', mp(rs.map((r) => r.scroll.slow.p95))); add(key, arm, 'scroll tasks >=50 ms (total)', rs.reduce((a, r) => a + r.scroll.longTasks.filter((e) => e.d >= 50).length, 0)) }
    if (key.startsWith('prepend')) { openRows('open P', rs.map((r) => r.open)); add(key, arm, 'older page lands while following: frames painted off the end (per run)', rs.map((r) => `${r.landing.offEnd}/${r.landing.frames}`).join(', ')); add(key, arm, 'landing: max distance off the end px (max)', Math.max(...rs.map((r) => r.landing.maxDist))); add(key, arm, 'landing: sync update work ms (mean / p95)', mp(rs.map((r) => r.landing.work))); add(key, arm, 'rows drawn after landing', rs.map((r) => r.rowsAfter).join(', ')) }
    if (key.startsWith('screen')) {
      const opened = (o) => o.timeToEnd != null && o.timeToEnd <= 300 && o.firstFrameAtEnd && o.framesBeforeEnd === 0
      const streamed = (u) => u.busyPerUpdate <= 16 && u.workP95 <= 16 && u.frames.p95 <= 20 && !u.longTasks.some((e) => e.d >= 50)
      openRows('open', rs.map((r) => r.mount)); openRows('cached switch (A parked)', rs.map((r) => r.cached))
      if (rs[0].small) openRows('40-row open', rs.map((r) => r.small))
      for (const [name, pick] of [['stream following (fixed 20 Hz)', (r) => r.streamFollow], ['stream parked (fixed 20 Hz)', (r) => r.streamParked], ['append following (fixed 20 Hz)', (r) => r.appendFollow], ['append parked (fixed 20 Hz)', (r) => r.appendParked]]) {
        if (!rs[0][name.startsWith('append following') ? 'appendFollow' : name.startsWith('append parked') ? 'appendParked' : 'streamFollow']) continue
        const u = rs.map(pick); updRows(name, u)
        add(key, arm, `${name}: layout / style / script ms per update (mean)`, `${f1(mean(u.map((x) => x.layoutPerUpdate)))} / ${f1(mean(u.map((x) => x.stylePerUpdate)))} / ${f1(mean(u.map((x) => x.scriptPerUpdate)))}`)
        add(key, arm, `${name}: layouts / style recalcs per update (mean)`, `${f1(mean(u.map((x) => x.busy.layoutCount / x.n)))} / ${f1(mean(u.map((x) => x.busy.styleCount / x.n)))}`)
        add(key, arm, `${name}: source lag max / final backlog ms (max)`, `${f1(Math.max(...u.map((x) => x.lagMax)))} / ${f1(Math.max(...u.map((x) => x.backlog)))}`)
      }
      add(key, arm, 'GATES per run (open / cached / stream following / stream parked)', rs.map((r) => [opened(r.mount), opened(r.cached), streamed(r.streamFollow), streamed(r.streamParked)].map((x) => (x ? 'P' : 'F')).join('')).join(' '))
      // decider3 useful-win: script <=8 following, busy <=32 following / <=24 parked, no task >=50, backlog within one 50 ms period.
      const useful = (r) => r.streamFollow.scriptPerUpdate <= 8 && r.streamFollow.busyPerUpdate <= 32 && r.streamParked.busyPerUpdate <= 24 && [r.streamFollow, r.streamParked, r.appendFollow, r.appendParked].every((u) => !u || (!u.longTasks.some((e) => e.d >= 50) && u.backlog <= 50))
      add(key, arm, 'USEFUL-WIN per run (stream thresholds, no long task, backlog drains; append vs main compared separately)', rs.map((r) => (useful(r) ? 'P' : 'F')).join(' '))
      add(key, arm, 'variant hash', [...new Set(rs.map((r) => r.variant))].join(','))
    }
    if (key.startsWith('geom') || key.startsWith('trace')) for (const r of rs) { const { arm: _a, rows: _r, throttle: _t, run: _n, structured: _s, ...rest } = r; add(key, arm, `run ${r.run}`, JSON.stringify(rest)) }
    if (key.startsWith('bodies')) for (const r of rs) add(key, arm, `bodies run ${r.run}`, JSON.stringify({ mount: r.mountBodies, sf: r.streamFollow.map((x) => x.n), af: r.appendFollow.map((x) => x.n), sp: r.streamParked.map((x) => x.n), ap: r.appendParked.map((x) => x.n) }))
    const errs = rs.flatMap((r) => r.errors || []); if (errs.length) add(key, arm, 'page errors', JSON.stringify([...new Set(errs)].slice(0, 3)))
  }
}
console.log('| case | arm | metric | value |\n|---|---|---|---|\n' + rowsOut.join('\n'))
