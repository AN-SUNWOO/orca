import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { useMobileNativeChatTailFollow } from './use-mobile-native-chat-tail-follow'

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }))

it('settles released contact using current geometry, without stranding cancellation or outside touches', async () => {
  vi.useFakeTimers()
  let follow: ReturnType<typeof useMobileNativeChatTailFollow<number>>
  function Probe() {
    follow = useMobileNativeChatTailFollow({ items: [1], scopeKey: 'chat' })
    return null
  }
  const scroll = (y: number, height = 1_000) =>
    follow.recordScrollMetrics({
      contentOffset: { x: 0, y },
      contentSize: { width: 320, height },
      layoutMeasurement: { width: 320, height: 500 },
      contentInset: { top: 0, bottom: 0, left: 0, right: 0 },
      zoomScale: 1
    })
  const touch = { identifier: 'list' }
  const start = () =>
    follow.listInputProps.onTouchStart({
      nativeEvent: { touches: [touch], changedTouches: [touch] }
    })
  const release = () =>
    follow.listInputProps.onTouchEnd({
      nativeEvent: { touches: [{ identifier: 'elsewhere' }], changedTouches: [touch] }
    })
  let renderer: ReturnType<typeof create> | undefined
  try {
    await act(() => {
      renderer = create(createElement(Probe))
    })
    act(() => {
      scroll(500)
      start()
      release()
      vi.advanceTimersByTime(200)
    })
    expect(follow!.following).toBe(true) // A tap does not detach.
    act(() => {
      start()
      scroll(460)
      vi.advanceTimersByTime(500)
    })
    expect(follow!.following).toBe(false)
    act(() => {
      follow.pinToTailAfterContentResize(320, 1_750)
      release()
      vi.advanceTimersByTime(200)
    })
    expect(follow!.following).toBe(false) // Growth during contact supersedes the old near-tail event.
    expect(follow!.showJumpToTail).toBe(true)
    act(() => {
      start()
      scroll(1_210, 1_750)
      release()
      vi.advanceTimersByTime(100)
      scroll(1_230, 1_750)
      vi.advanceTimersByTime(100)
    })
    expect(follow!.following).toBe(false)
    act(() => vi.advanceTimersByTime(100))
    expect(follow!.following).toBe(true)
    act(() => {
      scroll(1_250, 1_750)
      start()
      scroll(1_210, 1_750)
      follow.listInputProps.onTouchCancel()
      vi.advanceTimersByTime(500)
    })
    expect(follow!.following).toBe(false)
    expect(follow!.showJumpToTail).toBe(true)
    act(() => {
      follow.pinToTailAfterContentResize(320, 1_755)
      // RN Web can have queued this final notification before cancellation.
      setTimeout(() => scroll(1_210, 1_755), 100)
      vi.advanceTimersByTime(500)
    })
    expect(follow!.following).toBe(false)
    expect(follow!.showJumpToTail).toBe(true)
    act(() => {
      follow.listInputProps.onWheel?.({ deltaY: 20, ctrlKey: false })
      vi.advanceTimersByTime(200)
    })
    expect(follow!.following).toBe(true)
    act(() => follow.pinToTailAfterContentResize(320, 1_900))
    expect(follow!.following).toBe(true)
  } finally {
    act(() => renderer?.unmount())
    vi.useRealTimers()
  }
})
