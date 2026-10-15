import { createElement, type ForwardedRef } from 'react'
import { FlatList } from 'react-native'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { useMobileNativeChatTailFollow } from './use-mobile-native-chat-tail-follow'

const scrollToOffset = vi.hoisted(() => vi.fn())

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    Platform: { OS: 'web' },
    FlatList: React.forwardRef(
      (_props: object, ref: ForwardedRef<{ scrollToOffset: typeof scrollToOffset }>) => {
        React.useImperativeHandle(ref, () => ({ scrollToOffset }), [])
        return null
      }
    )
  }
})

it('on the page, only the reader detaches, and nothing moves the view under a finger', () => {
  vi.useFakeTimers()
  let follow: ReturnType<typeof useMobileNativeChatTailFollow<number>>
  function Probe() {
    follow = useMobileNativeChatTailFollow({ items: [1], scopeKey: 'chat' })
    return createElement(FlatList<number>, {
      ...follow.listInputProps,
      data: [1],
      renderItem: () => null
    })
  }
  const scroll = (y: number, height: number) =>
    follow.recordScrollMetrics({
      contentOffset: { x: 0, y },
      contentSize: { width: 320, height },
      layoutMeasurement: { width: 320, height: 500 },
      contentInset: { top: 0, bottom: 0, left: 0, right: 0 },
      zoomScale: 1
    })
  const grow = (height: number) => follow.pinToTailAfterContentResize(320, height)
  // The browser's live touches list after each event.
  const touches = (count: number) => ({
    nativeEvent: { touches: Array.from({ length: count }, () => ({})) }
  })
  const pinnedTo = (offset: number) =>
    expect(scrollToOffset).toHaveBeenLastCalledWith({ animated: false, offset })
  let renderer: ReactTestRenderer | undefined
  try {
    act(() => {
      renderer = create(createElement(Probe))
    })
    act(() => {
      scroll(500, 1_000)
      // A clamp or re-measure reads as a move up short of the end; no reader made it.
      scroll(400, 1_000)
      grow(1_500)
    })
    expect(follow!.following).toBe(true)
    expect(follow!.showJumpToTail).toBe(false)
    pinnedTo(1_500)

    // A held finger: output below it never pins, and shows the way back.
    scrollToOffset.mockClear()
    act(() => {
      scroll(1_000, 1_500)
      follow.listInputProps.onTouchStart(touches(1))
      grow(1_700)
    })
    expect(scrollToOffset).not.toHaveBeenCalled()
    expect(follow!.showJumpToTail).toBe(true)

    // That touch's end is lost with its removed element; the next touch lists only itself.
    act(() => {
      follow.listInputProps.onTouchStart(touches(1))
      scroll(800, 1_700)
      grow(1_900)
      follow.listInputProps.onTouchEnd(touches(0))
      vi.advanceTimersByTime(200)
    })
    expect(follow!.following).toBe(false)
    expect(follow!.showJumpToTail).toBe(true)

    // Back at the end, following resumes once the gesture is over.
    act(() => {
      follow.listInputProps.onTouchStart(touches(1))
      scroll(1_400, 1_900)
      follow.listInputProps.onTouchEnd(touches(0))
      grow(2_000)
    })
    expect(scrollToOffset).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(200)
    })
    pinnedTo(2_000)

    // A small nudge up leaves the reader where they stopped, with the jump control.
    scrollToOffset.mockClear()
    act(() => {
      scroll(1_500, 2_000)
      follow.listInputProps.onTouchStart(touches(1))
      scroll(1_460, 2_000)
      follow.listInputProps.onTouchEnd(touches(0))
      vi.advanceTimersByTime(200)
      grow(2_300)
    })
    expect(follow!.following).toBe(false)
    expect(follow!.showJumpToTail).toBe(true)

    // A cancelled touch, then RN Web's queued final notification, never snaps.
    act(() => {
      follow.listInputProps.onTouchStart(touches(1))
      follow.listInputProps.onTouchCancel(touches(0))
      setTimeout(() => scroll(1_460, 2_300), 100)
      vi.advanceTimersByTime(500)
    })
    expect(scrollToOffset).not.toHaveBeenCalled()
    expect(follow!.showJumpToTail).toBe(true)

    // A wheel is the reader's too; an explicit jump drops it, so the re-pin chase cannot detach.
    act(() => {
      follow.jumpToTail()
      scroll(1_800, 2_300)
      follow.listInputProps.onWheel?.({ deltaY: -40, ctrlKey: false })
      scroll(1_760, 2_300)
    })
    expect(follow!.following).toBe(false)
    act(() => {
      follow.jumpToTail()
      scroll(1_500, 2_300)
    })
    expect(follow!.following).toBe(true)
    expect(follow!.showJumpToTail).toBe(false)
    pinnedTo(2_300)
  } finally {
    act(() => renderer?.unmount())
    vi.useRealTimers()
  }
})
