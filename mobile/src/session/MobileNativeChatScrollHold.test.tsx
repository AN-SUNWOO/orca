import { createElement, Fragment } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileNativeChatScrollHold } from './MobileNativeChatScrollHold'

const platform = vi.hoisted(() => ({ OS: 'web' }))

vi.mock('react-native', () => ({ Platform: platform }))

describe('MobileNativeChatScrollHold', () => {
  let renderer: ReactTestRenderer | null = null

  /** A 600 tall view over one message row, which 2,000 of older history pushes down. */
  function scrollerAt(scrollTop: number) {
    const drawnHead = (): unknown => [renderer?.toJSON()].flat().find(Boolean)?.props.head
    const top = (): number => (drawnHead() === 'older' ? 2_300 : 300) - node.scrollTop
    const row = {
      getAttribute: () => 'chat-row:a',
      getBoundingClientRect: () => ({ top: top(), bottom: top() + 100 }),
      querySelectorAll: () => []
    }
    const node = {
      scrollTop,
      scrollHeight: 3_000,
      clientHeight: 600,
      getAttribute: () => null,
      getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
      querySelectorAll: () => [row]
    }
    return { node, listRef: { current: { getScrollableNode: () => node } } }
  }

  async function show(head: string, listRef: ReturnType<typeof scrollerAt>['listRef']) {
    const rowKeys = { sourceHead: head, current: (key: string) => key }
    const element = createElement(
      Fragment,
      null,
      createElement(MobileNativeChatScrollHold, { rowKeys, isFollowing: () => false, listRef }),
      createElement('rows', { head })
    )
    await act(async () => {
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
      }
    })
  }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    platform.OS = 'web'
  })

  it('leaves the view to iOS while it bounces the list past the top', async () => {
    const { node, listRef } = scrollerAt(-15)
    await show('a', listRef)

    await show('older', listRef)

    expect(node.scrollTop).toBe(-15)
  })

  it('does nothing in a native build, where the list holds its own place', async () => {
    platform.OS = 'ios'
    const { node, listRef } = scrollerAt(40)
    await show('a', listRef)

    await show('older', listRef)

    expect(node.scrollTop).toBe(40)
  })
})
