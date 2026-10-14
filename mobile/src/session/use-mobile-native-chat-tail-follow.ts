import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import {
  Platform,
  type FlatList,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native'

/** Distance from the bottom, in points, still treated as "at the tail". */
const AT_TAIL_SLOP = 80

/** RN Web's ScrollView reports no drag or momentum, so on the page the offsets themselves have to
 *  say what the reader did. It ignores `maintainVisibleContentPosition` too. */
function listReportsGestures(): boolean {
  return Platform.OS !== 'web'
}

/** Offset change, in points, below which the page treats the view as not having moved. */
const PAGE_MOVE_SLOP = 1

/** After release, allow momentum to quiet; RN Web's final scroll event trails it by 100 ms. */
const PAGE_SETTLE_MS = 150

/** Holds the first visible row in place when rows above it change. The header is not a row. */
const ANCHOR_BELOW_HEADER = { minIndexForVisible: 1 } as const
const ANCHOR_AT_FIRST_ROW = { minIndexForVisible: 0 } as const
export function mobileNativeChatRowAnchor(hasHeader: boolean): { minIndexForVisible: number } {
  return hasHeader ? ANCHOR_BELOW_HEADER : ANCHOR_AT_FIRST_ROW
}

function distanceFromTail(event: NativeScrollEvent): number {
  const { contentOffset, contentSize, layoutMeasurement } = event
  return contentSize.height - (contentOffset.y + layoutMeasurement.height)
}

function isAtTail(event: NativeScrollEvent): boolean {
  return distanceFromTail(event) <= AT_TAIL_SLOP
}

type PageTouch = { identifier: string | number }
type PageContactEvent = {
  nativeEvent: { touches: ArrayLike<PageTouch>; changedTouches: ArrayLike<PageTouch> }
}

export type MobileNativeChatTailFollow<TItem> = {
  /** Attach to the transcript list; the hook scrolls through this ref alone. */
  listRef: RefObject<FlatList<TItem> | null>
  listInputProps: {
    ref: (list: FlatList<TItem> | null) => void
    onTouchStart: (event: PageContactEvent) => void
    onTouchEnd: (event: PageContactEvent) => void
    onTouchCancel: () => void
  }
  /** Whether the view keeps to the newest message. */
  following: boolean
  /** Render flag for the jump-to-latest control. */
  showJumpToTail: boolean
  /** Passive maintenance: re-pin after the viewport resizes. */
  pinToTail: (event?: LayoutChangeEvent) => void
  /** Content-size maintenance using the list's authoritative measured height. */
  pinToTailAfterContentResize: (_width: number, height: number) => void
  /** Explicit jump — send, or the jump-to-latest control. Resumes following. */
  jumpToTail: () => void
  beginUserScroll: () => void
  endUserDrag: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
  beginMomentum: () => void
  endMomentum: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
  /** Whether a scroll near the top is the reader's own, and so may page in older history. */
  readerIsScrolling: () => boolean
  recordScrollMetrics: (event: NativeScrollEvent) => void
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
  /** The list's rows; an empty list is never scrolled. */
  items: readonly TItem[]
  /** The chat shown; another one opens following, whatever the reader did in this one. */
  scopeKey: string
}): MobileNativeChatTailFollow<TItem> {
  const { scopeKey } = args
  const hasItems = args.items.length > 0
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
  const pageContentHeightRef = useRef(0)
  const pageViewportHeightRef = useRef(0)
  const pageContactRef = useRef<'idle' | 'active' | 'released'>('idle')
  const pageTouchIdsRef = useRef(new Set<string | number>())
  const pageReaderMovedUpRef = useRef(false)
  const pageSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scopeKeyRef = useRef(scopeKey)

  // Single writer, so the event-time ref and the render flag cannot disagree.
  const setFollowing = useCallback((next: boolean) => {
    if (followingRef.current !== next) {
      followingRef.current = next
      setFollowingFlag(next)
    }
  }, [])

  const setAtTail = useCallback((next: boolean) => {
    if (atTailRef.current !== next) {
      atTailRef.current = next
      setAtTailFlag(next)
    }
  }, [])

  const pinToTail = useCallback(
    (event?: LayoutChangeEvent) => {
      if (event?.nativeEvent?.layout) {
        pageViewportHeightRef.current = event.nativeEvent.layout.height
      }
      if (!followingRef.current || !hasItems) {
        return
      }
      if (listReportsGestures()) {
        listRef.current?.scrollToEnd({ animated: false })
        return
      }
      // Why not `scrollToEnd`: its estimate can land short, and the page reads a move up as the reader's.
      listRef.current?.scrollToOffset({ animated: false, offset: pageContentHeightRef.current })
    },
    [hasItems]
  )

  const pinToTailAfterContentResize = useCallback(
    (_width: number, height: number) => {
      pageContentHeightRef.current = height
      if (!followingRef.current || !hasItems) {
        return
      }
      listRef.current?.scrollToOffset({ animated: false, offset: height })
    },
    [hasItems]
  )

  const clearUserScrollSettle = useCallback(() => {
    if (userScrollSettleFrameRef.current !== null) {
      cancelAnimationFrame(userScrollSettleFrameRef.current)
      userScrollSettleFrameRef.current = null
    }
    if (pageSettleTimerRef.current !== null) {
      clearTimeout(pageSettleTimerRef.current)
      pageSettleTimerRef.current = null
    }
  }, [])

  const retireListInput = useCallback(() => {
    clearUserScrollSettle()
    pageContactRef.current = 'idle'
    pageTouchIdsRef.current.clear()
    pageReaderMovedUpRef.current = false
    userScrollActiveRef.current = false
  }, [clearUserScrollSettle])

  const jumpToTail = useCallback(() => {
    retireListInput()
    setAtTail(true)
    setFollowing(true)
    pinToTail()
  }, [retireListInput, pinToTail, setAtTail, setFollowing])

  const settlePageScroll = useCallback(() => {
    clearUserScrollSettle()
    if (followingRef.current || pageContactRef.current === 'active') {
      return
    }
    pageSettleTimerRef.current = setTimeout(() => {
      pageSettleTimerRef.current = null
      const nearTail =
        pageContactRef.current === 'released'
          ? pageContentHeightRef.current - pageOffsetRef.current - pageViewportHeightRef.current <=
            AT_TAIL_SLOP
          : atTailRef.current
      pageContactRef.current = 'idle'
      setAtTail(nearTail)
      if (nearTail) {
        jumpToTail()
      }
    }, PAGE_SETTLE_MS)
  }, [clearUserScrollSettle, jumpToTail, setAtTail])

  const attachList = useCallback(
    (list: FlatList<TItem> | null) => {
      listRef.current = list
      if (!list) {
        retireListInput()
      }
    },
    [retireListInput]
  )

  const beginPageContact = useCallback(
    (event: PageContactEvent) => {
      if (!listReportsGestures()) {
        clearUserScrollSettle()
        pageContactRef.current = 'active'
        for (const touch of Array.from(event.nativeEvent.changedTouches)) {
          pageTouchIdsRef.current.add(touch.identifier)
        }
      }
    },
    [clearUserScrollSettle]
  )

  const endPageContact = useCallback(
    (event: PageContactEvent) => {
      if (listReportsGestures() || pageContactRef.current !== 'active') {
        return
      }
      for (const touch of Array.from(event.nativeEvent.changedTouches)) {
        pageTouchIdsRef.current.delete(touch.identifier)
      }
      if (pageTouchIdsRef.current.size === 0) {
        pageContactRef.current = 'released'
        settlePageScroll()
      }
    },
    [settlePageScroll]
  )

  const cancelPageContact = useCallback(() => {
    if (!listReportsGestures()) {
      // A cancel is not release; only a later scroll event can arm touchless settlement.
      retireListInput()
    }
  }, [retireListInput])

  const recordScrollMetrics = useCallback(
    (event: NativeScrollEvent) => {
      const endsAtTail = isAtTail(event)
      setAtTail(endsAtTail)
      if (listReportsGestures()) {
        return
      }
      const moved = event.contentOffset.y - pageOffsetRef.current
      pageOffsetRef.current = event.contentOffset.y
      pageContentHeightRef.current = event.contentSize.height
      pageViewportHeightRef.current = event.layoutMeasurement.height
      pageReaderMovedUpRef.current = moved < -PAGE_MOVE_SLOP
      if (followingRef.current) {
        // A pin only moves toward the end and a clamp lands on it: up and short of it is the reader.
        if (pageReaderMovedUpRef.current && distanceFromTail(event) > PAGE_MOVE_SLOP) {
          setFollowing(false)
        }
      } else if (moved > PAGE_MOVE_SLOP && endsAtTail && pageContactRef.current === 'idle') {
        setFollowing(true)
      }
      settlePageScroll()
    },
    [settlePageScroll, setAtTail, setFollowing]
  )

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

  const readerIsScrolling = useCallback(
    () => (listReportsGestures() ? userScrollActiveRef.current : pageReaderMovedUpRef.current),
    []
  )

  // Before paint, so the next chat never shows where the reader left the last one.
  useLayoutEffect(() => {
    if (scopeKeyRef.current !== scopeKey) {
      scopeKeyRef.current = scopeKey
      pageOffsetRef.current = 0
      jumpToTail()
    }
  }, [scopeKey, jumpToTail])

  useEffect(() => retireListInput, [retireListInput])

  return {
    listRef,
    listInputProps: {
      ref: attachList,
      onTouchStart: beginPageContact,
      onTouchEnd: endPageContact,
      onTouchCancel: cancelPageContact
    },
    following,
    showJumpToTail: !following && !atTail,
    pinToTail,
    pinToTailAfterContentResize,
    jumpToTail,
    beginUserScroll,
    endUserDrag,
    beginMomentum,
    endMomentum,
    readerIsScrolling,
    recordScrollMetrics
  }
}
