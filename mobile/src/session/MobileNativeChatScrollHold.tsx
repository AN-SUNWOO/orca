import { Component, type RefObject } from 'react'
import { Platform } from 'react-native'

type Box = { top: number; bottom: number }

/** The parts of a DOM element this reads; on the page the list's scrollable node is one. */
type RowElement = {
  getBoundingClientRect: () => Box
  getAttribute: (name: string) => string | null
}
type Scroller = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  getBoundingClientRect: () => Box
  querySelectorAll: (selector: string) => ArrayLike<RowElement>
}

/** The message the reader was on, by its row's id, and where it was. */
type Held = { rowId: string; top: number }

type Props = {
  /** The first row's key: a change in it is rows changing above the reader. */
  headKey: string | undefined
  listRef: RefObject<{ getScrollableNode: () => Scroller | null | undefined } | null>
}

const ROW_ID_PREFIX = 'chat-row:'

/** A message row's `testID`, which the page draws as `data-testid`. It sets message rows apart from
 *  the "Load earlier" control and the live status line, which don't move with the messages, and
 *  finds the row again when the update redraws it elsewhere. */
export function mobileNativeChatRowId(messageId: string): string {
  return `${ROW_ID_PREFIX}${messageId}`
}

function messageRows(scroller: Scroller): RowElement[] {
  return Array.from(scroller.querySelectorAll(`[data-testid^="${ROW_ID_PREFIX}"]`))
}

/** The message to hold: the first on screen, the one the reader is reading, or the last one above
 *  the screen when none is (a tall live status line). Never one the update drops: when the new
 *  first message is already drawn, every row above it is the oldest, trimmed at the 2,000 cap. */
function heldMessage(scroller: Scroller, headKey: string | undefined): Held | null {
  const view = scroller.getBoundingClientRect()
  const rows = messageRows(scroller)
  const headId = headKey === undefined ? null : mobileNativeChatRowId(headKey)
  const kept = Math.max(rows.findIndex((row) => row.getAttribute('data-testid') === headId), 0)
  // Rows in normal flow have ordered bottoms, so the first one on screen is found without
  // measuring the up to 2,000 above it.
  let low = kept
  let high = rows.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (rows[middle].getBoundingClientRect().bottom <= view.top) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  if (rows.length === 0) {
    return null
  }
  const held = rows[Math.min(low, rows.length - 1)]
  const rowId = held.getAttribute('data-testid')
  return rowId === null ? null : { rowId, top: held.getBoundingClientRect().top }
}

/** iOS is still bouncing the list past an end. A write then lands while WebKit owns the scroll, and
 *  the list stops taking the reader's scrolls until they leave the chat. */
function overscrolled({ scrollTop, scrollHeight, clientHeight }: Scroller): boolean {
  return scrollTop < 0 || scrollTop > scrollHeight - clientHeight + 1
}

/** Keeps the page's view on the same message when rows above it change, by putting the first
 *  message that was on screen back where it was. A class because only `getSnapshotBeforeUpdate`
 *  sees that message before the new rows are in the document. A native list holds its own place
 *  (`maintainVisibleContentPosition`). */
export class MobileNativeChatScrollHold extends Component<Props> {
  getSnapshotBeforeUpdate(previous: Props): Held | null {
    if (Platform.OS !== 'web' || previous.headKey === this.props.headKey) {
      return null
    }
    const scroller = this.props.listRef.current?.getScrollableNode()
    return scroller && !overscrolled(scroller) ? heldMessage(scroller, this.props.headKey) : null
  }

  componentDidUpdate(_previous: Props, _state: unknown, held: Held | null): void {
    const scroller = held ? this.props.listRef.current?.getScrollableNode() : null
    if (!held || !scroller) {
      return
    }
    const { rowId, top } = held
    const row = messageRows(scroller).find((each) => each.getAttribute('data-testid') === rowId)
    if (row) {
      scroller.scrollTop += row.getBoundingClientRect().top - top
    }
  }

  render(): null {
    return null
  }
}
