import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  Platform,
  type FlatList,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native'

/** Distance from the bottom, in points, still treated as "at the tail". */
const AT_TAIL_SLOP = 80

/** RN Web's ScrollView reports no drag or momentum, so on the page the reader's touch, wheel and
 *  keys stand in for them. It ignores `maintainVisibleContentPosition` too. */
function listReportsGestures(): boolean {
  return Platform.OS !== 'web'
}

/** Distance from the end, in points, within which the page's view is at it. */
const PAGE_END_SLOP = 1

/** Finger travel, in points, below which iOS does not take a touch as a pan of the list. */
const PAGE_PAN_SLOP = 10

/** Keys that scroll the page's list away from the end. */
const PAGE_UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])

/** The page's view rests at the end: not short of it, nor in iOS's bounce past it. */
function restsAtPageEnd(offset: number, contentHeight: number, viewportHeight: number): boolean {
  const end = Math.max(0, contentHeight - viewportHeight)
  return offset >= 0 && Math.abs(end - offset) <= PAGE_END_SLOP
}

/** A reader's touch on the page's list, from its first finger down to its last finger up. A second
 *  finger makes it the text pinch. A list whose content fits the screen is not `scrollable`. */
type PageTouch = { startY: number; wasFollowing: boolean; pinch: boolean; scrollable: boolean }

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

type ListInputProps = {
  onScrollBeginDrag: () => void
  onScrollEndDrag: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
  onMomentumScrollBegin: () => void
  onMomentumScrollEnd: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
  onTouchStart?: (event: GestureResponderEvent) => void
  onTouchEnd?: (event: GestureResponderEvent) => void
  onTouchCancel?: (event: GestureResponderEvent) => void
  onWheel?: (event: { deltaY: number; ctrlKey: boolean }) => void
  onKeyDown?: (event: { key: string }) => void
}

export type MobileNativeChatTailFollow<TItem> = {
  /** Attach to the transcript list; the hook scrolls through this ref alone. */
  listRef: RefObject<FlatList<TItem> | null>
  /** The reader's input on the list: a native list's drag and momentum, the page's touch, wheel
   *  and keys. */
  listInputProps: ListInputProps
  /** Render flag for the jump-to-latest control. */
  showJumpToTail: boolean
  /** Passive maintenance: re-pin after the viewport resizes. */
  pinToTail: (event?: LayoutChangeEvent) => void
  /** Content-size maintenance using the list's authoritative measured height. */
  pinToTailAfterContentResize: (_width: number, height: number) => void
  /** Explicit jump — send, or the jump-to-latest control. Resumes following. */
  jumpToTail: () => void
  /** Whether a scroll near the top may page in older history: only a native list's own drag. The
   *  page loads it only from the "Load earlier" control, since a page landing in iOS's top bounce
   *  gets the place-hold's write while WebKit owns the scroll, and the list stops scrolling. */
  scrollMayLoadEarlier: () => boolean
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
 *  the view argue with itself. Only the user's own input turns following off;
 *  reaching the end, or an explicit jump, turns it back on.
 */
export function useMobileNativeChatTailFollow<TItem>(args: {
  /** Guards `scrollToEnd` against an empty list. */
  hasItems: boolean
}): MobileNativeChatTailFollow<TItem> {
  const { hasItems } = args
  const listRef = useRef<FlatList<TItem> | null>(null)
  // Event handlers read intent at event time; only the control they decide is rendered.
  const followingRef = useRef(true)
  const atTailRef = useRef(true)
  const [showJumpToTail, setShowJumpToTail] = useState(false)
  const userScrollActiveRef = useRef(false)
  const userScrollSettleFrameRef = useRef<number | null>(null)
  // Page only: the last geometry seen, and the touch in place of the drag RN Web does not report.
  const pageOffsetRef = useRef(0)
  const pageContentHeightRef = useRef(0)
  const pageViewportHeightRef = useRef(0)
  const pageTouchRef = useRef<PageTouch | null>(null)

  // Single writers, so the event-time refs and the rendered control cannot disagree.
  const setFollowing = useCallback((next: boolean) => {
    followingRef.current = next
    setShowJumpToTail(!next && !atTailRef.current)
  }, [])

  const setAtTail = useCallback((next: boolean) => {
    atTailRef.current = next
    setShowJumpToTail(!followingRef.current && !next)
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
      // Why not `scrollToEnd`: its estimate can land short of the end.
      listRef.current?.scrollToOffset({ animated: false, offset: pageContentHeightRef.current })
    },
    [hasItems]
  )

  const pinToTailAfterContentResize = useCallback(
    (_width: number, height: number) => {
      pageContentHeightRef.current = height
      if (!followingRef.current && !listReportsGestures()) {
        // No scroll event says output landed below a parked view; the size does.
        setAtTail(height - pageOffsetRef.current - pageViewportHeightRef.current <= AT_TAIL_SLOP)
      }
      if (!followingRef.current || !hasItems) {
        return
      }
      listRef.current?.scrollToOffset({ animated: false, offset: height })
    },
    [hasItems, setAtTail]
  )

  const clearUserScrollSettle = useCallback(() => {
    if (userScrollSettleFrameRef.current !== null) {
      cancelAnimationFrame(userScrollSettleFrameRef.current)
      userScrollSettleFrameRef.current = null
    }
  }, [])

  const recordScrollMetrics = useCallback(
    (event: NativeScrollEvent) => {
      if (listReportsGestures()) {
        setAtTail(isAtTail(event))
        return
      }
      // Rows rendering, trims, holds and pins move the offset too, so no offset says the reader
      // left: only their input does. Reaching the end with no finger on the list resumes.
      const { contentOffset, contentSize, layoutMeasurement } = event
      pageOffsetRef.current = contentOffset.y
      pageViewportHeightRef.current = layoutMeasurement.height
      if (
        !pageTouchRef.current &&
        restsAtPageEnd(contentOffset.y, contentSize.height, layoutMeasurement.height)
      ) {
        setFollowing(true)
      }
      // While following the next pin owns the end.
      setAtTail(isAtTail(event) || followingRef.current)
    },
    [setAtTail, setFollowing]
  )

  const jumpToTail = useCallback(() => {
    clearUserScrollSettle()
    userScrollActiveRef.current = false
    pageTouchRef.current = null
    setAtTail(true)
    setFollowing(true)
    pinToTail()
  }, [clearUserScrollSettle, pinToTail, setAtTail, setFollowing])

  /** Page: the reader's finger stops following before iOS takes it as a pan, so no pin lands under
   *  a held finger or in the momentum after it. */
  const notePageTouchStart = useCallback(
    ({ nativeEvent: { touches, changedTouches } }: GestureResponderEvent) => {
      const touch = pageTouchRef.current
      if (!touch || touches.length === 1) {
        pageTouchRef.current = {
          startY: changedTouches[0]?.pageY ?? 0,
          wasFollowing: followingRef.current,
          pinch: false,
          scrollable: pageContentHeightRef.current - pageViewportHeightRef.current > PAGE_END_SLOP
        }
      } else {
        touch.pinch = true
      }
      setFollowing(false)
    },
    [setFollowing]
  )

  /** Page: following is re-derived at the lift. Only a pan down the screen over a list that can
   *  scroll takes the view from the end, so every other touch from following (a tap, a resting
   *  thumb, a pinch, a pan toward the end), and any touch on content that fits, gives it back and
   *  catches up. A parked reader's pan up the screen that rests at the end resumes there; a pan down
   *  never does, since its first scroll event can trail the lift. A lost end leaves following off. */
  const notePageTouchEnd = useCallback(
    ({ nativeEvent: { touches, changedTouches } }: GestureResponderEvent) => {
      const touch = pageTouchRef.current
      if (!touch || touches.length > 0) {
        return
      }
      pageTouchRef.current = null
      const towardEnd = touch.startY - (changedTouches[0]?.pageY ?? touch.startY)
      const offset = pageOffsetRef.current
      const end = Math.max(0, pageContentHeightRef.current - pageViewportHeightRef.current)
      const panned = !touch.pinch && Math.abs(towardEnd) >= PAGE_PAN_SLOP
      // No write lands in iOS's bounce after a pan; the scroll event where it settles resumes.
      if (panned && (offset < 0 || offset > end + PAGE_END_SLOP)) {
        return
      }
      const leftEnd = panned && touch.scrollable && towardEnd < 0
      if (
        (touch.wasFollowing && !leftEnd) ||
        !touch.scrollable ||
        (towardEnd >= PAGE_PAN_SLOP && Math.abs(end - offset) <= PAGE_END_SLOP)
      ) {
        jumpToTail()
      }
    },
    [jumpToTail]
  )

  const notePageWheel = useCallback(
    ({ deltaY, ctrlKey }: { deltaY: number; ctrlKey: boolean }) => {
      if (deltaY < 0 && !ctrlKey && pageOffsetRef.current > 0) {
        setFollowing(false)
      }
    },
    [setFollowing]
  )

  const notePageKey = useCallback(
    ({ key }: { key: string }) => {
      if (PAGE_UP_KEYS.has(key) && pageOffsetRef.current > 0) {
        setFollowing(false)
      }
    },
    [setFollowing]
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

  const scrollMayLoadEarlier = useCallback(
    () => listReportsGestures() && userScrollActiveRef.current,
    []
  )

  useEffect(() => clearUserScrollSettle, [clearUserScrollSettle])

  const listInputProps = useMemo<ListInputProps>(
    () => ({
      onScrollBeginDrag: beginUserScroll,
      onScrollEndDrag: endUserDrag,
      onMomentumScrollBegin: beginMomentum,
      onMomentumScrollEnd: endMomentum,
      ...(!listReportsGestures() && {
        onTouchStart: notePageTouchStart,
        onTouchEnd: notePageTouchEnd,
        onTouchCancel: notePageTouchEnd,
        onWheel: notePageWheel,
        onKeyDown: notePageKey
      })
    }),
    [
      beginUserScroll,
      endUserDrag,
      beginMomentum,
      endMomentum,
      notePageTouchStart,
      notePageTouchEnd,
      notePageWheel,
      notePageKey
    ]
  )

  return {
    listRef,
    listInputProps,
    showJumpToTail,
    pinToTail,
    pinToTailAfterContentResize,
    jumpToTail,
    scrollMayLoadEarlier,
    recordScrollMetrics
  }
}
