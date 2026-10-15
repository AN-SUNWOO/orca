import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  createNativeChatReplyRevealTracker,
  trackNativeChatReplyRows,
  type NativeChatReplyReveals
} from '../../../src/shared/native-chat-reply-reveals'
import { NATIVE_CHAT_TEXT_REVEAL_DELAY_MS as D } from '../../../src/shared/native-chat-text-reveal'
import { MobileNativeChatReducedMotionContext } from './mobile-native-chat-reply-reveals'

vi.mock('react-native', () => ({
  Image: 'Image',
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 }
}))
vi.mock('lucide-react-native', () => ({ Copy: 'Copy', Check: 'Check' }))
vi.mock('../components/MobileSelectableText', () => ({ MobileSelectableText: 'Text' }))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))
vi.mock('../platform/clipboard', () => ({ useClipboardWriter: () => ({ writeText: vi.fn() }) }))

import { MobileNativeChatMessage } from './MobileNativeChatMessage'

const first = 'word '.repeat(40)
const second = first + 'more '.repeat(40)

describe('a growing reply on the phone', () => {
  let renderer: ReactTestRenderer | undefined
  let reveals: NativeChatReplyReveals

  function render(text: string, reducedMotion = false): void {
    const message: NativeChatMessage = {
      id: 'a1',
      role: 'assistant',
      source: 'transcript',
      timestamp: null,
      blocks: [{ type: 'text', text }]
    }
    const row = createElement(MobileNativeChatMessage, {
      message,
      mayStillGrow: true,
      activeTurnIsWorking: true,
      replyReveals: reveals
    })
    const tree = createElement(
      MobileNativeChatReducedMotionContext.Provider,
      { value: reducedMotion },
      row
    )
    act(() => {
      if (renderer) {
        renderer.update(tree)
      } else {
        renderer = create(tree)
      }
    })
  }
  const drawn = (): number => {
    const markdown = renderer!.root.find((node) => String(node.type) === 'MobileMarkdown')
    return String(markdown.props.content).length
  }
  const advance = (ms: number): void => {
    act(() => {
      vi.advanceTimersByTime(ms)
    })
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    vi.stubGlobal('requestAnimationFrame', (step: () => void) => setTimeout(step, 16))
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => clearTimeout(frame))
    // A reply that began while the chat was open.
    const tracker = createNativeChatReplyRevealTracker()
    trackNativeChatReplyRows(tracker, ['u1'], new Set(['u1']))
    reveals = trackNativeChatReplyRows(tracker, ['u1', 'a1'], new Set(['u1', 'a1']))
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = undefined
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('reveals each chunk over time, and a remounted row resumes instead of replaying', () => {
    render(first)
    expect(drawn()).toBe('word'.length)
    advance(D / 2)
    expect(drawn()).toBeGreaterThan('word'.length)
    expect(drawn()).toBeLessThan(first.length)
    advance(D)
    expect(drawn()).toBe(first.length)

    render(second)
    advance(D / 2)
    const before = drawn()
    expect(before).toBeGreaterThan(first.length)
    expect(before).toBeLessThan(second.length)
    // The list recycles the row while it is still revealing.
    act(() => renderer?.unmount())
    renderer = undefined
    render(second)
    expect(drawn()).toBeGreaterThanOrEqual(before)
    expect(drawn()).toBeLessThan(second.length)
    advance(D)
    expect(drawn()).toBe(second.length)
  })

  it('draws the text as it arrives with reduced motion', () => {
    render(second, true)
    expect(drawn()).toBe(second.length)
  })
})
