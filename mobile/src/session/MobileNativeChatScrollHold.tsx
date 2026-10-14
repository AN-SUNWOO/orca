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

/** Keep every visible candidate: a head trim can remove more than the first one. */
function rowsOnScreen(scroller: Scroller, props: Props): Held[] {
  const content = scroller.firstElementChild
  if (!content) {
    return []
  }
  const view = scroller.getBoundingClientRect()
  const rows = messageRows(content, props)
  let low = 0
  let high = rows.length
  let firstBox: Box | undefined
  // Normal-flow vertical cells and spacers have ordered bottoms, including zero-height rows.
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    const box = rows[middle].getBoundingClientRect()
    if (box.bottom <= view.top) {
      low = middle + 1
    } else {
      high = middle
      firstBox = box
    }
  }
  const held: Held[] = []
  for (let index = low; index < rows.length; index++) {
    const row = rows[index]
    const box = index === low && firstBox ? firstBox : row.getBoundingClientRect()
    if (box.top >= view.bottom) {
      break
    }
    if (box.bottom > view.top) {
      held.push({ row, top: box.top })
    }
  }
  return held
}

/** Keeps the page's view on the same rows when rows above it change, by putting a row that was on
 *  screen back where it was. A class because only `getSnapshotBeforeUpdate` sees that row before
 *  the new ones are in the document. A native list holds its own place
 *  (`maintainVisibleContentPosition`). */
export class MobileNativeChatScrollHold extends Component<Props> {
  getSnapshotBeforeUpdate(previous: Props): Held[] | null {
    if (Platform.OS !== 'web' || !this.props.holding || previous.headKey === this.props.headKey) {
      return null
    }
    const scroller = this.props.listRef.current?.getScrollableNode()
    return scroller ? rowsOnScreen(scroller, previous) : null
  }

  componentDidUpdate(_previous: Props, _state: unknown, held: Held[] | null): void {
    const scroller = Platform.OS === 'web' ? this.props.listRef.current?.getScrollableNode() : null
    if (!scroller) {
      return
    }
    scroller.style.overflowAnchor = this.props.holding ? 'auto' : 'none'
    const survivor = held?.find(({ row }) => row.isConnected)
    if (survivor) {
      scroller.scrollTop += survivor.row.getBoundingClientRect().top - survivor.top
    }
  }

  render(): null {
    return null
  }
}
