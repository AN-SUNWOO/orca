// The real MobileNativeChatView of one arm, as the overlay renders it, fed deterministic chats.
import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Text, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { MobileNativeChatView } from 'ARMROOT/mobile/src/session/MobileNativeChatView.tsx'
import { foldMobileNativeChatMessages } from 'ARMROOT/mobile/src/session/mobile-native-chat-render-data.ts'
import { MobileNativeChatVisualContext } from 'ARMROOT/mobile/src/session/mobile-native-chat-visual-context.ts'
import { makeChat, makeMessage, para, rng } from './rows.js'

const q = new URLSearchParams(location.hash.slice(1))
const N = Number(q.get('rows') || 500)
const STRUCTURED = q.get('structured') !== '0'
const CAP = 2000 // the session's MAX_MESSAGES: an append at the cap trims the oldest message
// P: a chat whose 200 oldest messages land later as an older page.
const P_FULL = makeChat('P', N)
const CHATS = { A: makeChat('A', N), B: makeChat('B', N), S: makeChat('S', 40), P: P_FULL.slice(200) }
const NONE = []
const noop = () => {}
const accept = () => Promise.resolve(true)
const zero = () => 0
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }
// The newest row's key (a fresh key is its row's id), cached so the frame sampler never folds.
const lastRows = new WeakMap()
const lastRow = (messages) => {
  if (!lastRows.has(messages)) { const f = foldMobileNativeChatMessages(messages); lastRows.set(messages, f.length ? f[f.length - 1].id : null) }
  return lastRows.get(messages)
}
Object.values(CHATS).concat([P_FULL]).forEach(lastRow)

// A live turn while updates run: the structured lane's status line and working rows update with it.
const WORKING = { thinking: false, activityText: 'Editing files', stopping: false }
const STARTED = Date.now()

function Chat({ chat, messages, streaming, working }) {
  const folded = useMemo(() => foldMobileNativeChatMessages(messages), [messages])
  return (
    <MobileNativeChatView
      messages={messages}
      folded={folded}
      status="ready"
      agent="claude"
      agentWorking={working}
      turnIndicator={working ? WORKING : null}
      workingStartedAt={working ? STARTED : null}
      structuredActivityUi={STRUCTURED}
      streaming={streaming}
      hasMore
      olderPages="idle"
      onLoadEarlier={noop}
      onSend={accept}
      sendSurfaceId={chat}
      getSendCompletionGeneration={zero}
      getComposerEditGeneration={zero}
      pending={NONE}
      composerText=""
      onComposerTextChange={noop}
    />
  )
}

function App() {
  const [st, setSt] = useState({ chat: 'A', mounted: false, chats: CHATS, streaming: null, working: false })
  window.__st = st
  // Every update is synchronous so its work can be timed; the probe applies it from a page task.
  window.__set = (patch) => { const t = performance.now(); flushSync(() => setSt((s) => ({ ...s, ...patch }))); return performance.now() - t }
  window.__tick = (kind, k) => {
    const t = performance.now()
    flushSync(() => setSt((s) => {
      if (kind === 'prepend') return { ...s, chats: { ...s.chats, P: P_FULL } }
      if (kind === 'stream') {
        const r = rng(k + 99)
        const words = para(r).split(' ').slice(0, 6).join(' ')
        return { ...s, working: true, streaming: s.streaming === null ? words : s.streaming + (k % 5 === 4 ? '\n\n' : ' ') + words }
      }
      const d = s.chats[s.chat]; const r = rng(d.length + 7)
      const m = { ...makeMessage(s.chat, 100000 + d.length + k, r), role: 'assistant', blocks: [{ type: 'text', text: para(r) }] }
      const next = d.length >= CAP ? [...d.slice(1), m] : [...d, m]
      return { ...s, working: true, chats: { ...s.chats, [s.chat]: next } }
    }))
    return performance.now() - t
  }
  window.__lastId = () => (st.streaming !== null ? null : lastRow(st.chats[st.chat]))
  if (!st.mounted) return <View><Text>idle</Text></View>
  return <Chat chat={st.chat} messages={st.chats[st.chat]} streaming={st.streaming} working={st.working} />
}

createRoot(document.getElementById('root')).render(
  <SafeAreaProvider initialMetrics={METRICS} style={{ flex: 1 }}>
    <MobileNativeChatVisualContext.Provider value={null}>
      <View style={{ height: 844, width: 390, display: 'flex' }}>
        <App />
      </View>
    </MobileNativeChatVisualContext.Provider>
  </SafeAreaProvider>
)
