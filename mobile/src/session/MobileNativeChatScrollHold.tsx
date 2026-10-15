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

/** A message the reader was on, by its row's id, and where it was. */
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

/** The messages the reader is reading, top first: those on screen, or the nearest one when none is
 *  (only the live status line is). */
function messagesOnScreen(scroller: Scroller): Held[] {
  const view = scroller.getBoundingClientRect()
  const rows = messageRows(scroller)
  // Rows in normal flow have ordered bottoms, so the first one on screen is found without
  // measuring the up to 2,000 above it.
  let low = 0
  let high = rows.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (rows[middle].getBoundingClientRect().bottom <= view.top) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  const held: Held[] = []
  for (let index = Math.max(Math.min(low, rows.length - 1), 0); index < rows.length; index += 1) {
    const { top } = rows[index].getBoundingClientRect()
    const rowId = rows[index].getAttribute('data-testid')
    if (held.length > 0 && top >= view.bottom) {
      break
    }
    if (rowId !== null) {
      held.push({ rowId, top })
    }
  }
  return held
}

/** iOS is still bouncing the list past an end. A write then lands while WebKit owns the scroll, and
 *  the list stops taking the reader's scrolls until they leave the chat. */
function overscrolled({ scrollTop, scrollHeight, clientHeight }: Scroller): boolean {
  return scrollTop < 0 || scrollTop > scrollHeight - clientHeight + 1
}

/** Keeps the page's view on the same message when rows above it change, by putting the first
 *  message that was on screen back where it was. When the update dropped that message (the 2,000
 *  cap trims the oldest), the nearest one below it that the update kept stands in. A class because
 *  only `getSnapshotBeforeUpdate` sees those messages before the new rows are in the document. A
 *  native list holds its own place (`maintainVisibleContentPosition`). */
export class MobileNativeChatScrollHold extends Component<Props> {
  getSnapshotBeforeUpdate(previous: Props): Held[] | null {
    if (Platform.OS !== 'web' || previous.headKey === this.props.headKey) {
      return null
    }
    const scroller = this.props.listRef.current?.getScrollableNode()
    return scroller && !overscrolled(scroller) ? messagesOnScreen(scroller) : null
  }

  componentDidUpdate(_previous: Props, _state: unknown, held: Held[] | null): void {
    const scroller = held?.length ? this.props.listRef.current?.getScrollableNode() : null
    if (!held || !scroller) {
      return
    }
    const rows = new Map(messageRows(scroller).map((row) => [row.getAttribute('data-testid'), row]))
    const kept = held.find(({ rowId }) => rows.has(rowId))
    const row = kept && rows.get(kept.rowId)
    if (kept && row) {
      scroller.scrollTop += row.getBoundingClientRect().top - kept.top
    }
  }

  render(): null {
    return null
  }
}
