import { Component, type RefObject } from 'react'
import { Platform } from 'react-native'
import type { MobileNativeChatRowKeys } from './mobile-native-chat-row-keys'

type Box = { top: number; bottom: number }

/** The parts of a DOM element this reads; on the page the list's scrollable node is one. */
type Tagged = {
  getBoundingClientRect: () => Box
  getAttribute: (name: string) => string | null
  querySelectorAll: (selector: string) => ArrayLike<Tagged>
}
type Scroller = Tagged & { scrollTop: number; scrollHeight: number; clientHeight: number }

/** A row the reader was on, where it was, and the line inside it they were reading. */
type Held = { key: string; top: number; member?: { id: string; top: number } }

type Props = {
  rowKeys: Pick<MobileNativeChatRowKeys, 'sourceHead' | 'current'>
  /** Whether the reader follows the end, which then owns the scroll. */
  isFollowing: () => boolean
  listRef: RefObject<{ getScrollableNode: () => Scroller | null | undefined } | null>
}

const ROW = 'chat-row:'
const MEMBER = 'chat-member:'

/** A message row's `testID`, which the page draws as `data-testid`. It sets message rows apart from
 *  the "Load earlier" control and the live status line, which don't move with the messages. */
export function mobileNativeChatRowId(key: string): string {
  return `${ROW}${key}`
}

/** A tool line's `testID`, by its line identity, or the run's, inside a row. */
export function mobileNativeChatMemberId(id: string): string {
  return `${MEMBER}${id}`
}

/** Tagged elements in document order; ids are compared, never put in a selector. */
function tagged(node: Tagged, prefix: string): { id: string; node: Tagged }[] {
  return Array.from(node.querySelectorAll(`[data-testid^="${prefix}"]`), (element) => ({
    id: element.getAttribute('data-testid')?.slice(prefix.length) ?? '',
    node: element
  }))
}

function onScreen(box: Box, view: Box): boolean {
  return box.bottom > view.top && box.top < view.bottom
}

/** The first line on screen in the reader's first row, else its run (which holds its lines). */
function memberOnScreen(row: Tagged, view: Box): Held['member'] {
  const shown = tagged(row, MEMBER).filter((m) => onScreen(m.node.getBoundingClientRect(), view))
  const member = shown.find((m) => m.id !== 'run') ?? shown[0]
  return member && { id: member.id, top: member.node.getBoundingClientRect().top }
}

/** The rows the reader is reading, top first: those on screen, or the nearest one when none is
 *  (only the live status line is). */
function placeOnScreen(scroller: Scroller): Held[] {
  const view = scroller.getBoundingClientRect()
  const rows = tagged(scroller, ROW)
  // Rows in normal flow have ordered bottoms, so the first one on screen is found without
  // measuring the up to 2,000 above it.
  let low = 0
  let high = rows.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (rows[middle]!.node.getBoundingClientRect().bottom <= view.top) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  const held: Held[] = []
  for (let at = Math.max(Math.min(low, rows.length - 1), 0); at < rows.length; at += 1) {
    const { top } = rows[at]!.node.getBoundingClientRect()
    if (held.length > 0 && top >= view.bottom) {
      break
    }
    const member = held.length === 0 ? memberOnScreen(rows[at]!.node, view) : undefined
    held.push({ key: rows[at]!.id, top, ...(member ? { member } : {}) })
  }
  return held
}

/** An orphan result's line is its call's once older messages bring the call. */
function memberIn(row: Tagged, id: string): Tagged | undefined {
  const paired = id.startsWith('result:') ? `call:${id.slice('result:'.length)}` : id
  return tagged(row, MEMBER).find((m) => m.id === id || m.id === paired)?.node
}

/** iOS is still bouncing the list past an end. A write then lands while WebKit owns the scroll, and
 *  the list stops taking the reader's scrolls until they leave the chat. */
function overscrolled({ scrollTop, scrollHeight, clientHeight }: Scroller): boolean {
  return scrollTop < 0 || scrollTop > scrollHeight - clientHeight + 1
}

/** Keeps a parked reader's place on the page when the source window changes above them (an older
 *  page, a cap trim): the line they were reading, else their row, else the nearest row the update
 *  kept goes back where it was. A following reader is left to the follow owner, which holds the
 *  end. A class because only `getSnapshotBeforeUpdate` sees the rows before the update is in the
 *  document. A native list holds its own place (`maintainVisibleContentPosition`). */
export class MobileNativeChatScrollHold extends Component<Props> {
  getSnapshotBeforeUpdate(previous: Props): Held[] | null {
    if (
      Platform.OS !== 'web' ||
      previous.rowKeys.sourceHead === this.props.rowKeys.sourceHead ||
      this.props.isFollowing()
    ) {
      return null
    }
    const scroller = this.props.listRef.current?.getScrollableNode()
    return scroller && !overscrolled(scroller) ? placeOnScreen(scroller) : null
  }

  componentDidUpdate(_previous: Props, _state: unknown, held: Held[] | null): void {
    const scroller = held?.length ? this.props.listRef.current?.getScrollableNode() : null
    if (!held || !scroller) {
      return
    }
    const rows = new Map(tagged(scroller, ROW).map(({ id, node }) => [id, node]))
    for (const place of held) {
      const key = this.props.rowKeys.current(place.key)
      const row = key === undefined ? undefined : rows.get(key)
      if (!row) {
        continue
      }
      const line = place.member && memberIn(row, place.member.id)
      const anchor: { node: Tagged; top: number } =
        line && place.member ? { node: line, top: place.member.top } : { node: row, top: place.top }
      scroller.scrollTop += anchor.node.getBoundingClientRect().top - anchor.top
      return
    }
  }

  render(): null {
    return null
  }
}
