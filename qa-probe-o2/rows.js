// Deterministic chat rows with the shapes a coding-agent chat has: prompts, prose, fenced code, tool calls.
const WORDS = 'the list renders rows from the end so the reader sees the newest message first while older history stays above and scrolls in when needed this change keeps the pin on attach and measures layout before paint session worktree terminal agent host mobile page virtualized window batch frame cell offset height'.split(' ')
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) }
const sentence = (r, n) => { const w = []; for (let i = 0; i < n; i++) w.push(WORDS[Math.floor(r() * WORDS.length)]); const s = w.join(' '); return s[0].toUpperCase() + s.slice(1) + '.' }
const para = (r) => { const out = []; const n = 1 + Math.floor(r() * 4); for (let i = 0; i < n; i++) { let s = sentence(r, 6 + Math.floor(r() * 14)); if (r() < 0.3) s = s.replace(/ (\w+) /, ' `$1()` '); if (r() < 0.2) s = s.replace(/ (\w+) /, ' **$1** '); out.push(s) } return out.join(' ') }
const code = (r) => { const n = 5 + Math.floor(r() * 25); const l = []; for (let i = 0; i < n; i++) l.push('  '.repeat(Math.floor(r() * 3)) + `const ${WORDS[Math.floor(r() * WORDS.length)]}${i} = ${WORDS[Math.floor(r() * WORDS.length)]}(${i}, '${WORDS[Math.floor(r() * WORDS.length)]}')`); return '```ts\n' + l.join('\n') + '\n```' }
const TOOLS = [['Read', (r) => ({ file_path: `src/session/file-${Math.floor(r() * 90)}.ts` })], ['Bash', (r) => ({ command: `rg -n "${WORDS[Math.floor(r() * WORDS.length)]}" src | head -20` })], ['Edit', (r) => ({ file_path: `src/a-${Math.floor(r() * 50)}.tsx`, old_string: 'a', new_string: 'b' })], ['Grep', (r) => ({ pattern: WORDS[Math.floor(r() * WORDS.length)] })]]
function makeMessage(chat, i, r) {
  const id = `${chat}-${i}`
  const base = { id, timestamp: 1760000000000 + i * 1000, source: 'transcript' }
  const k = r()
  if (k < 0.15) return { ...base, role: 'user', blocks: [{ type: 'text', text: sentence(r, 5 + Math.floor(r() * 30)) }] }
  if (k < 0.55) {
    let text = para(r)
    if (r() < 0.4) text += '\n\n- ' + sentence(r, 6) + '\n- ' + sentence(r, 9) + '\n- ' + sentence(r, 5)
    if (r() < 0.25) text += '\n\n' + code(r)
    if (r() < 0.5) text += '\n\n' + para(r)
    return { ...base, role: 'assistant', blocks: [{ type: 'text', text }] }
  }
  const blocks = r() < 0.5 ? [{ type: 'text', text: sentence(r, 8 + Math.floor(r() * 10)) }] : []
  const n = 1 + Math.floor(r() * 3)
  for (let t = 0; t < n; t++) {
    const [name, input] = TOOLS[Math.floor(r() * TOOLS.length)]
    const callId = `${id}-c${t}`
    blocks.push({ type: 'tool-call', name, input: input(r), callId, state: 'completed' })
    blocks.push({ type: 'tool-result', callId, output: Array.from({ length: 1 + Math.floor(r() * 8) }, () => sentence(r, 8)).join('\n') })
  }
  return { ...base, role: 'assistant', blocks }
}
function makeChat(chat, n) { const r = rng(chat.charCodeAt(0) * 7919 + n); return Array.from({ length: n }, (_, i) => makeMessage(chat, i, r)) }
module.exports = { makeChat, makeMessage, para, sentence, rng }
