import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileNativeChatScrollHold } from './MobileNativeChatScrollHold'

const platform = vi.hoisted(() => ({ OS: 'web' }))

vi.mock('react-native', () => ({ Platform: platform }))

type Row = {
  isConnected: boolean
  children: Row[]
  getBoundingClientRect: () => { top: number; bottom: number }
}

/** A row 100 tall whose top is `tops[0]` when first measured and `tops[1]` from then on. */
function row(tops: number[], children: Row[] = []): Row {
  const answers = [...tops]
  return {
    isConnected: true,
    children,
    getBoundingClientRect: () => {
      const top = answers.length > 1 ? (answers.shift() ?? 0) : answers[0]
      return { top, bottom: top + 100 }
    }
  }
}

/** A 600 tall view, 40 from the top of its content, over the given header block and list rows. */
function scrollerOver(headerRows: Row[], listRows: Row[], footer?: Row) {
  const header = row([-40], headerRows)
  const heights = [1_000, 3_500]
  const node = {
    scrollTop: 40,
    style: { overflowAnchor: 'auto' },
    // Grows by 2,500 where 2,000 lands above the reader: live output lands below in the same update.
    get scrollHeight(): number {
      return heights.length > 1 ? (heights.shift() ?? 0) : heights[0]
    },
    getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
    firstElementChild: row([-40], [header, ...listRows, ...(footer ? [footer] : [])])
  }
  return { node, listRef: { current: { getScrollableNode: () => node } } }
}

describe('MobileNativeChatScrollHold', () => {
  let renderer: ReactTestRenderer | null = null

  async function show(
    headKey: string,
    listRef: ReturnType<typeof scrollerOver>['listRef'],
    { holding = true, loadEarlier = false, footer = false } = {}
  ) {
    const element = createElement(MobileNativeChatScrollHold, {
      headKey,
      holding,
      loadEarlier,
      footer,
      listRef
    })
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

  it('moves by what landed above the reader, not by live output landing below it too', async () => {
    const onScreen = row([300, 2_300])
    const { node, listRef } = scrollerOver([], [row([100, 2_100]), onScreen, row([700, 3_200])])
    await show('a', listRef)

    await show('older', listRef)

    expect(node.scrollTop).toBe(2_040)
  })

  it('holds a reader who is inside the loaded history, above the list’s own rows', async () => {
    const control = row([-40])
    const { node, listRef } = scrollerOver([control, row([200, 2_200])], [row([900, 2_900])])
    await show('a', listRef, { loadEarlier: true })

    await show('older', listRef, { loadEarlier: true })

    expect(node.scrollTop).toBe(2_040)
  })

  it('holds by the reader’s row, not the live status line that output below pushes down', async () => {
    const liveLine = row([500, 2_800])
    const { node, listRef } = scrollerOver([], [row([100, 2_100])], liveLine)
    await show('a', listRef, { footer: true })

    await show('older', listRef, { footer: true })

    expect(node.scrollTop).toBe(2_040)
  })

  it('classifies the old layout when the final page removes its control and adds a footer', () => {
    const control = row([0])
    const message = row([50, 2_050])
    const { node, listRef } = scrollerOver([control], [message])
    const previous = { listRef, headKey: 'a', holding: true, loadEarlier: true, footer: false }
    const hold = new MobileNativeChatScrollHold({
      ...previous,
      headKey: 'older',
      loadEarlier: false,
      footer: true
    })
    const snapshot = hold.getSnapshotBeforeUpdate(previous)
    control.isConnected = false
    hold.componentDidUpdate(previous, null, snapshot)
    expect(node.scrollTop).toBe(2_040)
  })

  it('holds the first surviving visible row after a multi-row trim, with bounded measurements', () => {
    let shift = 0
    let measurements = 0
    const rows = Array.from({ length: 2_000 }, (_, index) => ({
      isConnected: true,
      children: [],
      getBoundingClientRect: () => {
        measurements++
        const top = (index - 1_990) * 100 + shift
        return { top, bottom: top + 100 }
      }
    }))
    const { node, listRef } = scrollerOver([], rows)
    node.scrollTop = 199_000
    const previous = { listRef, headKey: 'a', holding: true, loadEarlier: false, footer: false }
    const hold = new MobileNativeChatScrollHold({ ...previous, headKey: 'trimmed' })
    const snapshot = hold.getSnapshotBeforeUpdate(previous)
    expect(snapshot?.map(({ row }) => row)).toEqual(rows.slice(1_990, 1_996))
    expect(measurements).toBeLessThan(25)
    rows[1_990].isConnected = rows[1_991].isConnected = false
    shift = -200
    hold.componentDidUpdate(previous, null, snapshot)
    expect(node.scrollTop).toBe(198_800)
  })

  // At the 2,000-row ceiling every new message drops the first row; a hold then read as the reader.
  it('leaves a following view to tail-follow, with the browser’s own anchoring off too', async () => {
    const { node, listRef } = scrollerOver([], [row([300, 2_300])])
    await show('a', listRef, { holding: false })

    await show('trimmed', listRef, { holding: false })

    expect(node.scrollTop).toBe(40)
    expect(node.style.overflowAnchor).toBe('none')
  })

  it('leaves the view alone when the row it was holding is gone', async () => {
    const onScreen = row([300, 2_300])
    const { node, listRef } = scrollerOver([], [onScreen])
    await show('a', listRef)
    onScreen.isConnected = false

    await show('older', listRef)

    expect(node.scrollTop).toBe(40)
  })

  it('leaves the view alone while the first row is the same', async () => {
    const { node, listRef } = scrollerOver([], [row([300, 2_300])])
    await show('a', listRef)

    await show('a', listRef)

    expect(node.scrollTop).toBe(40)
  })

  it('does nothing in a native build, where the list holds its own place', async () => {
    platform.OS = 'ios'
    const { node, listRef } = scrollerOver([], [row([300, 2_300])])
    await show('a', listRef)

    await show('older', listRef)

    expect(node.scrollTop).toBe(40)
  })
})
