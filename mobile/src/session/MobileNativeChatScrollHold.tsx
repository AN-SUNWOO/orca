import { Component, type RefObject } from 'react'
import { Platform } from 'react-native'

type Box = { top: number; bottom: number }

/** The parts of a DOM element this reads; on the page the list's scrollable node is one. */
type RowElement = {
  isConnected: boolean
  getBoundingClientRect: () => Box
  children: ArrayLike<RowElement>
}
type Scroller = {
  scrollTop: number
  style: { overflowAnchor: string }
  getBoundingClientRect: () => Box
  firstElementChild: RowElement | null
}

type Held = { row: RowElement; top: number }

type Props = {
  /** The first row's key: a change in it is rows changing above the reader. */
  headKey: string | undefined
  /** Off while following: then tail-follow alone places the view, and a hold, this one or the
   *  browser's own scroll anchoring, would read as the reader moving up. */
  holding: boolean
  /** The header leads with the "Load earlier" control, which stays put as history lands under it. */
  loadEarlier: boolean
  /** A footer cell (live status, waiting messages) ends the list; output above it moves it. */
  footer: boolean
  listRef: RefObject<{ getScrollableNode: () => Scroller | null | undefined } | null>
}

/** The message rows in drawing order. With no header the first cell's own element stands for it. */
function messageRows(content: RowElement, { loadEarlier, footer }: Props): RowElement[] {
  const [header, ...cells] = Array.from(content.children)
  if (footer) {
    cells.pop()
  }
  return [...Array.from(header?.children ?? []).slice(loadEarlier ? 1 : 0), ...cells]
}

/** The first message row on screen: output landing below it never moves it. */
function firstRowOnScreen(scroller: Scroller, props: Props): Held | null {
  const content = scroller.firstElementChild
  if (!content) {
    return null
  }
  const view = scroller.getBoundingClientRect()
  for (const row of messageRows(content, props)) {
    const box = row.getBoundingClientRect()
    if (box.top < view.bottom && box.bottom > view.top) {
      return { row, top: box.top }
    }
  }
  return null
}

/** Keeps the page's view on the same rows when rows above it change, by putting a row that was on
 *  screen back where it was. A class because only `getSnapshotBeforeUpdate` sees that row before
 *  the new ones are in the document. A native list holds its own place
 *  (`maintainVisibleContentPosition`). */
export class MobileNativeChatScrollHold extends Component<Props> {
  getSnapshotBeforeUpdate(previous: Props): Held | null {
    if (Platform.OS !== 'web' || !this.props.holding || previous.headKey === this.props.headKey) {
      return null
    }
    const scroller = this.props.listRef.current?.getScrollableNode()
    return scroller ? firstRowOnScreen(scroller, this.props) : null
  }

  componentDidUpdate(_previous: Props, _state: unknown, held: Held | null): void {
    const scroller = Platform.OS === 'web' ? this.props.listRef.current?.getScrollableNode() : null
    if (!scroller) {
      return
    }
    scroller.style.overflowAnchor = this.props.holding ? 'auto' : 'none'
    if (held?.row.isConnected) {
      scroller.scrollTop += held.row.getBoundingClientRect().top - held.top
    }
  }

  render(): null {
    return null
  }
}
