import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatView } from './MobileNativeChatView'

const scrollToOffset = vi.hoisted(() => vi.fn())
const pageScroller = vi.hoisted(() => ({ scrollTop: 0, scrollHeight: 0, clientHeight: 500 }))

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: React.forwardRef((props, ref) => {
      const list = { scrollToEnd: vi.fn(), scrollToOffset, getScrollableNode: () => pageScroller }
      React.useImperativeHandle(ref, () => list, [])
      return React.createElement('FlatList', props)
    }),
    Platform: { OS: 'web' },
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: 'Text',
    View: 'View'
  }
})
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))
vi.mock('react-native-gesture-handler', () => {
  const chain = { runOnJS: () => chain, onStart: () => chain, onUpdate: () => chain }
  return {
    Gesture: { Simultaneous: () => ({}), Native: () => ({}), Pinch: () => chain },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})
vi.mock('lucide-react-native', () => ({
  ArrowDown: 'ArrowDown',
  ChevronsDownUp: 'ChevronsDownUp',
  ChevronsUpDown: 'ChevronsUpDown',
  Square: 'Square'
}))
vi.mock('./MobileNativeChatMessage', () => ({ MobileNativeChatMessage: 'ChatMessage' }))
vi.mock('./MobileNativeChatLiveLine', () => ({ MobileNativeChatLiveLine: 'LiveStatus' }))
vi.mock('./MobileNativeChatComposer', () => ({ MobileNativeChatComposer: 'Composer' }))
vi.mock('../components/ActionSheetModal', () => ({ ActionSheetModal: 'ActionSheetModal' }))
vi.mock('./MobileNativeChatAsk', () => ({ MobileNativeChatAsk: 'ChatAsk' }))
vi.mock('./MobileNativeChatPermission', () => ({ MobileNativeChatPermission: 'ChatPermission' }))
vi.mock('./MobileNativeChatQuestion', () => ({ MobileNativeChatQuestion: 'ChatQuestion' }))
vi.mock('./MobileAgentWorkingIndicator', () => ({
  MobileAgentWorkingIndicator: 'WorkingIndicator'
}))

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

const turn = (id: string): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'text', text: id }],
  timestamp: 0,
  source: 'hook'
})

const view = (folded: NativeChatMessage[]) =>
  createElement(MobileNativeChatView, {
    messages: [],
    folded,
    status: 'ready',
    streaming: null,
    onSend: vi.fn().mockResolvedValue(true),
    sendSurfaceId: 'tab-a',
    getSendCompletionGeneration: () => 0,
    pending: [],
    composerText: '',
    onComposerTextChange: vi.fn()
  })

it('keeps a following reader at the cap out of the browser anchoring while the oldest row is trimmed', () => {
  const list = () => renderer!.root.find((node) => String(node.type) === 'FlatList')
  const scrolledTo = (y: number) => {
    const at = { contentOffset: { y }, contentSize: { height: 1_000 } }
    act(() => list().props.onScroll({ nativeEvent: { ...at, layoutMeasurement: { height: 500 } } }))
  }
  // What the page's scroller tells the browser: the transcript's wrapper, then the end marker.
  const wrapper = () => {
    const page = list().props.renderScrollComponent({ children: 'rows' })
    const [content, marker, ...rest] = page.type(page.props).props.children
    expect(rest).toHaveLength(0)
    expect(marker.props.style).toEqual({ height: 1 })
    expect(content.props.children).toBe('rows')
    return content.props.style
  }
  const jumps = () =>
    renderer!.root.findAll((node) => node.props.accessibilityLabel === 'Scroll to latest')
  const turns = ['a1', 'a2', 'a3', 'a4'].map(turn)
  act(() => {
    renderer = create(view(turns.slice(0, 3)))
  })
  scrolledTo(500)

  // Trim plus append of the same height: no size change, so the owner rightly does nothing.
  act(() => renderer!.update(view(turns.slice(1))))
  expect(scrollToOffset).not.toHaveBeenCalled()
  expect(jumps()).toHaveLength(0)
  expect(wrapper()).toContainEqual({ overflowAnchor: 'none' })

  // Parked, the browser may anchor a message again; the jump back follows the end once more.
  scrolledTo(300)
  expect(wrapper()).not.toContainEqual({ overflowAnchor: 'none' })
  act(() => jumps()[0].props.onPress())
  expect(wrapper()).toContainEqual({ overflowAnchor: 'none' })
})
