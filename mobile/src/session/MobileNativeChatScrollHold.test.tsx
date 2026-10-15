import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileNativeChatScrollHold, mobileNativeChatRowId } from './MobileNativeChatScrollHold'

const platform = vi.hoisted(() => ({ OS: 'web' }))

vi.mock('react-native', () => ({ Platform: platform }))

/** An element 100 tall: a message row's id (null: the Load earlier control, a turn's status row or
 *  the live line, which carry none), its top before the update and after it (null: gone). */
type Row = [id: string | null, before: number, after: number | null]

/** A 600 tall view, 40 from the top of its content, over the given elements in document order.
 *  Every read builds fresh elements, as a redrawn row would be. */
function scrollerOver(rows: Row[], scrollTop = 40) {
  let landed = false
  const node = {
    scrollTop,
    scrollHeight: 3_500,
    clientHeight: 600,
    getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
    querySelectorAll: (selector: string) => {
      const prefix = /^\[data-testid\^="([^"]+)"\]$/.exec(selector)?.[1]
      if (prefix === undefined) {
        throw new Error(`unexpected selector ${selector}`)
      }
      return rows.flatMap(([id, before, after]) => {
        const top = landed ? after : before
        const testId = id === null ? null : mobileNativeChatRowId(id)
        if (top === null || !testId?.startsWith(prefix)) {
          return []
        }
        const box = { top, bottom: top + 100 }
        return [
          {
            getAttribute: (name: string) => (name === 'data-testid' ? testId : null),
            getBoundingClientRect: () => box
          }
        ]
      })
    }
  }
  // The first read is the snapshot before the update; later ones see it landed.
  let reads = 0
  const getScrollableNode = () => {
    landed = reads++ > 0
    return node
  }
  return { node, listRef: { current: { getScrollableNode } } }
}

describe('MobileNativeChatScrollHold', () => {
  let renderer: ReactTestRenderer | null = null

  async function show(headKey: string, listRef: ReturnType<typeof scrollerOver>['listRef']) {
    const element = createElement(MobileNativeChatScrollHold, { headKey, listRef })
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

  it('holds the first message on screen, not output landing below it too', async () => {
    const { node, listRef } = scrollerOver([
      [null, -250, 1_750],
      ['above', -150, 1_850],
      [null, -50, 1_950],
      ['reading', 50, 2_050],
      ['live', 150, 2_800],
      [null, 250, 2_900]
    ])
    await show('a', listRef)

    await show('older', listRef)

    expect(node.scrollTop).toBe(2_040)
  })

  it('leaves the view alone when the message it was holding is gone', async () => {
    const { node, listRef } = scrollerOver([['reading', 300, null]])
    await show('a', listRef)

    await show('older', listRef)

    expect(node.scrollTop).toBe(40)
  })

  it('at the 2,000 cap, holds the nearest message the trim keeps', async () => {
    // The oldest message, trimmed, was the first on screen; the browser kept the offset.
    const reading = scrollerOver(
      [
        ['oldest', -50, null],
        ['kept', 50, -50]
      ],
      400
    )
    await show('oldest', reading.listRef)
    await show('kept', reading.listRef)
    expect(reading.node.scrollTop).toBe(300)

    // Only the live status line is on screen, below the last message.
    act(() => renderer?.unmount())
    renderer = null
    const footer = scrollerOver(
      [
        ['oldest', -800, null],
        ['kept', -300, -400],
        [null, 500, 400]
      ],
      400
    )
    await show('oldest', footer.listRef)
    await show('kept', footer.listRef)
    expect(footer.node.scrollTop).toBe(300)
  })

  it('leaves the view to iOS while it bounces the list past the top', async () => {
    const { node, listRef } = scrollerOver([['reading', 100, 2_100]], -15)
    await show('a', listRef)

    await show('older', listRef)

    expect(node.scrollTop).toBe(-15)
  })

  it('leaves the view alone while the first row is the same', async () => {
    const { node, listRef } = scrollerOver([['reading', 300, 2_300]])
    await show('a', listRef)

    await show('a', listRef)

    expect(node.scrollTop).toBe(40)
  })

  it('does nothing in a native build, where the list holds its own place', async () => {
    platform.OS = 'ios'
    const { node, listRef } = scrollerOver([['reading', 300, 2_300]])
    await show('a', listRef)

    await show('older', listRef)

    expect(node.scrollTop).toBe(40)
  })
})
