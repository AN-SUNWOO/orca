import { createElement as h, Fragment, useMemo, type ReactElement } from 'react'
import {
  act,
  create,
  type ReactTestRenderer,
  type ReactTestRendererJSON as Node
} from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { splitNativeChatBlocks } from '../../../src/shared/native-chat-tool-fold'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { useMobileNativeChatRowKeys } from './mobile-native-chat-row-keys'
import { MobileNativeChatScrollHold, mobileNativeChatRowId } from './MobileNativeChatScrollHold'
import { ToolRun } from './MobileNativeChatToolRun'
import { useMobileNativeChatPageHistory } from './use-mobile-native-chat-page-history'

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  Text: 'span',
  View: 'div',
  Pressable: 'button'
}))
vi.mock('lucide-react-native', () => ({
  ChevronDown: () => null,
  SquareChevronRight: () => null,
  SquareTerminal: () => null,
  Wrench: () => null
}))
vi.mock('./mobile-native-chat-message-styles', () => ({ styles: {} }))

const say = (id: string, role: 'user' | 'assistant', text: string): NativeChatMessage => ({
  id,
  role,
  timestamp: null,
  source: 'transcript',
  blocks: [{ type: 'text', text }]
})
const edit = (n: number): NativeChatBlock => {
  const lines = (word: string): string => Array.from({ length: 30 }, () => word).join('\n')
  const input = { file_path: `f${n}.ts`, old_string: lines('old'), new_string: lines('new') }
  return { type: 'tool-call', name: 'Edit', callId: `c${n}`, input }
}
const run = (n: number): NativeChatMessage[] => [
  { ...say(`a${n}`, 'assistant', ''), blocks: [edit(n)] },
  { ...say(`r${n}`, 'user', ''), blocks: [{ type: 'tool-result', callId: `c${n}`, output: 'ok' }] }
]
// An earlier turn, then a reply working silently through 40 edits.
const chat = [say('u0', 'user', 'first'), say('x0', 'assistant', 'answer'), say('u1', 'user', 'go')]
  .concat({
    ...say('a1', 'assistant', 'On it'),
    blocks: [{ type: 'text', text: 'On it' }, edit(1)]
  })
  .concat(run(1).slice(1), ...Array.from({ length: 39 }, (_, i) => run(i + 2)))

type Box = { id: string; top: number; bottom: number; end: number }
type Element = {
  getAttribute: () => string
  getBoundingClientRect: () => { top: number; bottom: number }
  querySelectorAll: (selector: string) => Element[]
}

const oldHostTail = (): NativeChatMessage[] => JSON.parse(JSON.stringify(chat))

/** The page laid out with one 20-tall line per text, served as the list's scrollable node. */
function page(tree: () => Node | Node[] | null) {
  const boxes = (): Box[] => {
    const out: Box[] = []
    let y = 0
    const walk = (node: Node | string): void => {
      if (typeof node === 'string' || node.type === 'span') {
        y += typeof node === 'string' ? 0 : 20
        return
      }
      const at = out.push({ id: String(node.props.testID ?? ''), top: y, bottom: y, end: 0 }) - 1
      node.children?.forEach(walk)
      out[at] = { ...out[at]!, bottom: y, end: out.length }
    }
    walk({ type: 'page', props: {}, children: [tree() ?? []].flat() })
    return out
  }
  const select = (all: Box[], from: number, to: number, selector: string): Element[] => {
    const prefix = /\^="([^"]+)"/.exec(selector)?.[1] ?? '?'
    return all.flatMap((box, at) =>
      at >= from && at < to && box.id.startsWith(prefix)
        ? [
            {
              getAttribute: () => box.id,
              getBoundingClientRect: () => ({
                top: box.top - node.scrollTop,
                bottom: box.bottom - node.scrollTop
              }),
              querySelectorAll: (inner: string) => select(all, at + 1, box.end, inner)
            }
          ]
        : []
    )
  }
  const node = {
    scrollTop: 0,
    clientHeight: 200,
    get scrollHeight(): number {
      return boxes()[0]?.bottom ?? 0
    },
    getAttribute: () => null,
    getBoundingClientRect: () => ({ top: 0, bottom: 200 }),
    querySelectorAll: (selector: string): Element[] => select(boxes(), 0, Infinity, selector),
    top: (id: string): number =>
      (boxes().find((box) => box.id === id)?.top ?? Number.NaN) - node.scrollTop
  }
  return node
}

function Row({ message, rowKey }: { message: NativeChatMessage; rowKey: string }): ReactElement {
  const { prose, tools } = splitNativeChatBlocks(message.blocks)
  const words = prose.map((block, i) =>
    h('span', { key: i }, block.type === 'text' ? block.text : '')
  )
  const run =
    tools.length > 0 &&
    h(ToolRun, { blocks: tools, defaultExpanded: false, expandChildren: false, activeCall: null })
  return h('div', { testID: mobileNativeChatRowId(rowKey) }, words, run)
}

type Scroller = ReturnType<typeof page>

function Chat(props: {
  messages: NativeChatMessage[]
  following: boolean
  live: boolean
  listRef: { current: { getScrollableNode: () => Scroller } }
}): ReactElement {
  const folded = useMemo(() => foldMobileNativeChatMessages(props.messages), [props.messages])
  const keys = useMobileNativeChatRowKeys(folded, props.messages, 'chat')
  const renderRow = ({ item }: { item: NativeChatMessage }) =>
    h(Row, { message: item, rowKey: keys.keyOf(item) })
  const history = useMobileNativeChatPageHistory(folded, renderRow, keys)
  return h(
    Fragment,
    null,
    h(MobileNativeChatScrollHold, {
      rowKeys: keys,
      isFollowing: () => props.following,
      listRef: props.listRef
    }),
    h('div', { testID: 'header' }, history.withHistory(h('span', null, 'Load earlier'))),
    history.listRows.map((item, index) =>
      h(Fragment, { key: keys.keyOf(item) }, history.renderListRow({ item, index }))
    ),
    props.live ? h('span', null, 'Working') : null
  )
}

function mount(messages: NativeChatMessage[], options = { following: false, live: false }) {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(h('div'))
  })
  const scroller = page(() => renderer.toJSON())
  const listRef = { current: { getScrollableNode: () => scroller } }
  const show = (next: NativeChatMessage[]) =>
    act(() => renderer.update(h(Chat, { ...options, messages: next, listRef })))
  show(messages)
  const press = (id: string) =>
    act(() =>
      renderer.root
        .find((n) => n.props.testID === id)
        .findAllByType('button')[0]!
        .props.onPress()
    )
  const drawn = (id: string) => renderer.root.findAll((n) => n.props.testID === id).length
  const lines = (id: string) =>
    renderer.root.find((n) => n.props.testID === id).findAllByType('span').length
  return { scroller, show, press, drawn, lines, root: () => renderer.root }
}

it('keeps the line a reader was on, its run open, when older messages join the run from an old host', () => {
  const chat0 = mount(chat.slice(chat.findIndex((m) => m.id === 'r21')))
  chat0.press(mobileNativeChatRowId('a22'))
  chat0.press('chat-member:call:c24')
  const opened = chat0.lines('chat-member:call:c24')
  chat0.scroller.scrollTop = chat0.scroller.top('chat-member:call:c24') + chat0.scroller.scrollTop

  // An old host ignores the cursor and sends the whole tail again: new objects, the same ids.
  chat0.show(oldHostTail())

  // The run keeps its row, so the earlier turn sits above it and the run stays open.
  const header = chat0.root().find((n) => n.props.testID === 'header')
  expect(
    header.findAll((n) => String(n.props.testID).startsWith('chat-row:')).map((n) => n.props.testID)
  ).toEqual(['u0', 'x0', 'u1'].map(mobileNativeChatRowId))
  expect(chat0.scroller.top('chat-member:call:c24')).toBe(0)
  expect(chat0.lines('chat-member:call:c24')).toBe(opened)
  expect(chat0.drawn('chat-member:call:c1')).toBe(1)

  // A reply and a send land after the run: what the reader had loaded stays drawn.
  chat0.show([...oldHostTail(), say('done', 'assistant', 'Done'), say('ask', 'user', 'next')])
  expect(chat0.drawn(mobileNativeChatRowId('a22'))).toBe(1)
  expect(chat0.drawn('chat-member:call:c24')).toBe(1)
})

it('at the cap, a trim and an append of equal height hold a parked reader and leave a following one to follow', () => {
  const rows = Array.from({ length: 13 }, (_, i) =>
    say(`m${i}`, i % 2 ? 'assistant' : 'user', `message ${i}`)
  )
  for (const options of [
    { following: true, live: false },
    { following: true, live: true },
    { following: false, live: false }
  ]) {
    const chat0 = mount(rows.slice(0, 12), options)
    chat0.scroller.scrollTop = options.following ? chat0.scroller.scrollHeight - 200 : 50
    const before = {
      scrollTop: chat0.scroller.scrollTop,
      m4: chat0.scroller.top(mobileNativeChatRowId('m4'))
    }

    chat0.show(rows.slice(1))

    if (options.following) {
      expect(chat0.scroller.scrollTop).toBe(before.scrollTop)
    } else {
      expect(chat0.scroller.top(mobileNativeChatRowId('m4'))).toBe(before.m4)
    }
  }
})
