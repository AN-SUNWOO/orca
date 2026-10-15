import { createElement, useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  Platform,
  type FlatList,
  type FlatListProps,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps
} from 'react-native'
import { MobileNativeChatPageScroll } from './MobileNativeChatPageScroll'

/** Distance from the bottom, in points, still treated as "at the tail". */
const AT_TAIL_SLOP = 80

/** RN Web's ScrollView reports no drag or momentum, so on the page the offsets themselves have to
 *  say what the reader did. It ignores `maintainVisibleContentPosition` too. */
function listReportsGestures(): boolean {
  return Platform.OS !== 'web'
}

/** Offset change, in points, below which the page treats the view as not having moved. */
const PAGE_MOVE_SLOP = 1

/** Holds the first visible row in place when rows above it change. The header is not a row. */
const ANCHOR_BELOW_HEADER = { minIndexForVisible: 1 } as const
const ANCHOR_AT_FIRST_ROW = { minIndexForVisible: 0 } as const

export function mobileNativeChatRowAnchor(hasHeader: boolean): { minIndexForVisible: number } {
  return hasHeader ? ANCHOR_BELOW_HEADER : ANCHOR_AT_FIRST_ROW
}

/** The list's scrollable node on the page, as RN Web's ScrollView decorates it. */
type PageScroller = Element & {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  getInnerViewNode: () => Element
}

/** RN Web reports content size a task after layout, so a frame can paint between growth and a pin
 *  driven by that report. An observer on the scroller and its content runs before that paint. */
function observePageResize(
  scroller: PageScroller | null | undefined,
  onResize: () => void
): ResizeObserver | null {
  if (!scroller || typeof ResizeObserver === 'undefined') {
    return null
  }
  const observer = new ResizeObserver(onResize)
  observer.observe(scroller)
  observer.observe(scroller.getInnerViewNode())
  return observer
}

function distanceFromTail(event: NativeScrollEvent): number {
  const { contentOffset, contentSize, layoutMeasurement } = event
  return contentSize.height - (contentOffset.y + layoutMeasurement.height)
}

function isAtTail(event: NativeScrollEvent): boolean {
  return distanceFromTail(event) <= AT_TAIL_SLOP
}

export type MobileNativeChatTailFollow<TItem> = {
  /** Spread on the list. `ref`: the hook scrolls through it alone; on the page it also watches the
   *  list resize while mounted. The page's scroller keeps the end as the browser's anchor while
   *  the reader follows. */
  listProps: {
    ref: (list: FlatList<TItem> | null) => () => void
    renderScrollComponent: FlatListProps<TItem>['renderScrollComponent']
  }
  /** Render flag for the jump-to-latest control. */
  showJumpToTail: boolean
  /** Passive maintenance: re-pin after the viewport resizes. */
  pinToTail: () => void
  /** Content-size maintenance: native uses the measured height, the page its live end. */
  pinToTailAfterContentResize: (_width: number, height: number) => void
  /** Explicit jump — send, or the jump-to-latest control. Resumes following. */
  jumpToTail: () => void
  beginUserScroll: () => void
  endUserDrag: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
  beginMomentum: () => void
  endMomentum: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
  /** Whether a scroll near the top may page in older history: only a native list's own drag. The
   *  page loads it only from the "Load earlier" control, since a page landing in iOS's top bounce
   *  gets the place-hold's write while WebKit owns the scroll, and the list stops scrolling. */
  scrollMayLoadEarlier: () => boolean
  recordScrollMetrics: (event: NativeScrollEvent) => void
  /** Read at commit by the page's place-hold: the list, and whether the reader follows the end. */
  placeHold: { listRef: RefObject<FlatList<TItem> | null>; isFollowing: () => boolean }
}

/** Sole owner of transcript scroll position.
 *
 *  Streaming used to have several tail-followers at once: a delayed *animated*
 *  `scrollToEnd` alongside an immediate non-animated one on content growth. The
 *  animated command eases toward the endpoint measured when it started, so while
 *  tokens kept arriving it ran backwards until the content-size pin yanked it
 *  forward — the visible drift-then-snap. One owner, never animated, removes it.
 *
 *  Intent (`following`) is kept separate from geometry (at-tail): a programmatic
 *  scroll reports metrics like any other, so letting metrics decide intent let
 *  the view argue with itself. Only the user's own gestures and explicit jumps
 *  move intent; metrics only decide where a *released* gesture leaves us.
 */
export function useMobileNativeChatTailFollow<TItem>(args: {
  /** Guards `scrollToEnd` against an empty list. */
  hasItems: boolean
}): MobileNativeChatTailFollow<TItem> {
  const { hasItems } = args
  const listRef = useRef<FlatList<TItem> | null>(null)
  const [following, setFollowingFlag] = useState(true)
  const [atTail, setAtTailFlag] = useState(true)
  // Event handlers read intent at event time, before a re-render lands.
  const followingRef = useRef(true)
  const atTailRef = useRef(true)
  const userScrollActiveRef = useRef(false)
  const userScrollSettleFrameRef = useRef<number | null>(null)
  // Page only: what the offsets last said, in place of the gestures RN Web does not report.
  const pageOffsetRef = useRef(0)

  // Single writer, so the event-time ref and the render flag cannot disagree.
  const setFollowing = useCallback((next: boolean) => {
    if (followingRef.current === next) {
      return
    }
    followingRef.current = next
    setFollowingFlag(next)
  }, [])

  const setAtTail = useCallback((next: boolean) => {
    if (atTailRef.current === next) {
      return
    }
    atTailRef.current = next
    setAtTailFlag(next)
  }, [])

  // Live geometry: a size report arrives late and can name an end the view has already left.
  // Not `scrollToEnd`: its estimate can land short, and the page reads a move up as the reader's.
  const pinPageToEnd = useCallback(() => {
    const scroller: PageScroller | null | undefined = listRef.current?.getScrollableNode()
    if (!followingRef.current || !scroller) {
      return
    }
    const end = scroller.scrollHeight - scroller.clientHeight
    // Already there, or iOS bouncing past an end: a write then lands while WebKit owns the scroll.
    if (scroller.scrollTop < 0 || scroller.scrollTop >= end - PAGE_MOVE_SLOP) {
      return
    }
    listRef.current?.scrollToOffset({ animated: false, offset: end })
  }, [])

  const attachList = useCallback(
    (list: FlatList<TItem> | null) => {
      listRef.current = list
      const page = !listReportsGestures()
      const observer = page ? observePageResize(list?.getScrollableNode(), pinPageToEnd) : null
      return () => {
        observer?.disconnect()
        listRef.current = null
      }
    },
    [pinPageToEnd]
  )

  const pinToTail = useCallback(() => {
    if (!listReportsGestures()) {
      pinPageToEnd()
    } else if (followingRef.current && hasItems) {
      listRef.current?.scrollToEnd({ animated: false })
    }
  }, [hasItems, pinPageToEnd])

  const pinToTailAfterContentResize = useCallback(
    (_width: number, height: number) => {
      if (!listReportsGestures()) {
        pinPageToEnd()
      } else if (followingRef.current && hasItems) {
        listRef.current?.scrollToOffset({ animated: false, offset: height })
      }
    },
    [hasItems, pinPageToEnd]
  )

  const clearUserScrollSettle = useCallback(() => {
    if (userScrollSettleFrameRef.current !== null) {
      cancelAnimationFrame(userScrollSettleFrameRef.current)
      userScrollSettleFrameRef.current = null
    }
  }, [])

  const recordScrollMetrics = useCallback(
    (event: NativeScrollEvent) => {
      const endsAtTail = isAtTail(event)
      setAtTail(endsAtTail)
      if (listReportsGestures()) {
        return
      }
      const moved = event.contentOffset.y - pageOffsetRef.current
      pageOffsetRef.current = event.contentOffset.y
      if (followingRef.current) {
        // A pin only moves toward the end and a clamp lands on it: up and short of it is the reader.
        if (moved < -PAGE_MOVE_SLOP && distanceFromTail(event) > PAGE_MOVE_SLOP) {
          setFollowing(false)
        }
      } else if (moved > PAGE_MOVE_SLOP && endsAtTail) {
        setFollowing(true)
      }
    },
    [setAtTail, setFollowing]
  )

  const jumpToTail = useCallback(() => {
    clearUserScrollSettle()
    userScrollActiveRef.current = false
    setAtTail(true)
    setFollowing(true)
    pinToTail()
  }, [clearUserScrollSettle, pinToTail, setAtTail, setFollowing])

  const beginUserScroll = useCallback(() => {
    clearUserScrollSettle()
    userScrollActiveRef.current = true
    setFollowing(false)
  }, [clearUserScrollSettle, setFollowing])

  const finishUserScroll = useCallback(
    (finishedAtTail: boolean) => {
      if (!userScrollActiveRef.current) {
        return
      }
      clearUserScrollSettle()
      userScrollActiveRef.current = false
      setAtTail(finishedAtTail)
      setFollowing(finishedAtTail)
      if (finishedAtTail) {
        pinToTail()
      }
    },
    [clearUserScrollSettle, pinToTail, setAtTail, setFollowing]
  )

  const endUserDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!userScrollActiveRef.current) {
        return
      }
      clearUserScrollSettle()
      const releasedAtTail = isAtTail(event.nativeEvent)
      userScrollSettleFrameRef.current = requestAnimationFrame(() => {
        userScrollSettleFrameRef.current = null
        finishUserScroll(releasedAtTail)
      })
    },
    [clearUserScrollSettle, finishUserScroll]
  )

  const beginMomentum = useCallback(() => {
    if (userScrollActiveRef.current) {
      clearUserScrollSettle()
    }
  }, [clearUserScrollSettle])

  const endMomentum = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) =>
      finishUserScroll(isAtTail(event.nativeEvent)),
    [finishUserScroll]
  )

  const scrollMayLoadEarlier = useCallback(
    () => listReportsGestures() && userScrollActiveRef.current,
    []
  )

  const isFollowing = useCallback(() => followingRef.current, [])

  const renderPageScroll = useCallback(
    (props: ScrollViewProps) =>
      createElement(MobileNativeChatPageScroll, { ...props, endAnchored: following }),
    [following]
  )

  useEffect(() => clearUserScrollSettle, [clearUserScrollSettle])

  return {
    listProps: {
      ref: attachList,
      renderScrollComponent: listReportsGestures() ? undefined : renderPageScroll
    },
    showJumpToTail: !following && !atTail,
    pinToTail,
    pinToTailAfterContentResize,
    jumpToTail,
    beginUserScroll,
    endUserDrag,
    beginMomentum,
    endMomentum,
    scrollMayLoadEarlier,
    recordScrollMetrics,
    placeHold: { listRef, isFollowing }
  }
}
