import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Platform,
  type FlatList,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native'
import {
  AT_TAIL_SLOP,
  distanceFromTail,
  isAtTail,
  isPageScrollKey,
  type MobileNativeChatTailFollow,
  type PageTouchEvent
} from './mobile-native-chat-scroll-policy'
export { mobileNativeChatRowAnchor } from './mobile-native-chat-scroll-policy'
export type { MobileNativeChatTailFollow } from './mobile-native-chat-scroll-policy'

/** RN Web's ScrollView reports no drag or momentum, so on the page the offsets themselves have to
 *  say what the reader did. It ignores `maintainVisibleContentPosition` too. */
function listReportsGestures(): boolean {
  return Platform.OS !== 'web'
}

/** Offset change, in points, below which the page treats the view as not having moved. */
const PAGE_MOVE_SLOP = 1

/** Scroll quiet that ends a page gesture after its last touch, wheel or key; RN Web's final scroll
 *  event trails the last move by 100 ms. */
const PAGE_GESTURE_QUIET_MS = 150

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
 *  the view argue with itself. Only the reader's own input turns following off;
 *  reaching the end or an explicit jump turns it back on.
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
  const pageReaderMovedUpRef = useRef(false)
  // Page gesture: a finger on the list per the browser's live touches, then scroll quiet.
  const pageTouchingRef = useRef(false)
  const pageGestureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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

  const pageGestureLive = useCallback(
    () => pageTouchingRef.current || pageGestureTimerRef.current !== null,
    []
  )

  /** Page: a pin under a live gesture would move the view under the reader's finger, and iOS
   *  puts its own position back on release. Content that grows meanwhile shows the jump control. */
  const pinPageOffset = useCallback(
    (offset: number) => {
      if (!pageGestureLive()) {
        listRef.current?.scrollToOffset({ animated: false, offset })
      } else if (offset - pageOffsetRef.current - pageViewportHeightRef.current > AT_TAIL_SLOP) {
        setAtTail(false)
      }
    },
    [pageGestureLive, setAtTail]
  )

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
      pinPageOffset(pageContentHeightRef.current)
    },
    [hasItems, pinPageOffset]
  )

  const pinToTailAfterContentResize = useCallback(
    (_width: number, height: number) => {
      pageContentHeightRef.current = height
      if (!followingRef.current || !hasItems) {
        return
      }
      if (listReportsGestures()) {
        listRef.current?.scrollToOffset({ animated: false, offset: height })
      } else {
        pinPageOffset(height)
      }
    },
    [hasItems, pinPageOffset]
  )

  const clearUserScrollSettle = useCallback(() => {
    if (userScrollSettleFrameRef.current !== null) {
      cancelAnimationFrame(userScrollSettleFrameRef.current)
      userScrollSettleFrameRef.current = null
    }
  }, [])

  const clearPageGesture = useCallback(() => {
    pageTouchingRef.current = false
    if (pageGestureTimerRef.current !== null) {
      clearTimeout(pageGestureTimerRef.current)
      pageGestureTimerRef.current = null
    }
  }, [])

  const jumpToTail = useCallback(() => {
    clearUserScrollSettle()
    clearPageGesture()
    userScrollActiveRef.current = false
    setAtTail(true)
    setFollowing(true)
    pinToTail()
  }, [clearUserScrollSettle, clearPageGesture, pinToTail, setAtTail, setFollowing])

  /** Page: momentum, and a pan the browser took over from the page, keep a gesture going after
   *  its last touch event, so it ends at scroll quiet. Then pins held off for it catch up. */
  const extendPageGesture = useCallback(() => {
    if (pageGestureTimerRef.current !== null) {
      clearTimeout(pageGestureTimerRef.current)
      pageGestureTimerRef.current = null
    }
    if (pageTouchingRef.current) {
      return
    }
    pageGestureTimerRef.current = setTimeout(() => {
      pageGestureTimerRef.current = null
      if (followingRef.current) {
        setAtTail(true)
        pinToTail()
      }
    }, PAGE_GESTURE_QUIET_MS)
  }, [pinToTail, setAtTail])

  // Why the live touches list, not the touches this list saw end: a touch whose element is removed
  // mid-touch ends on that element, out of React's reach.
  const notePageTouches = useCallback(
    (event: PageTouchEvent) => {
      if (!listReportsGestures()) {
        pageTouchingRef.current = event.nativeEvent.touches.length > 0
        extendPageGesture()
      }
    },
    [extendPageGesture]
  )

  const attachList = useCallback(
    (list: FlatList<TItem> | null) => {
      listRef.current = list
      if (!list) {
        // Touches on a removed list end out of React's reach.
        clearPageGesture()
      }
    },
    [clearPageGesture]
  )

  const recordScrollMetrics = useCallback(
    (event: NativeScrollEvent) => {
      const endsAtTail = isAtTail(event)
      if (listReportsGestures()) {
        setAtTail(endsAtTail)
        return
      }
      const moved = event.contentOffset.y - pageOffsetRef.current
      pageOffsetRef.current = event.contentOffset.y
      pageContentHeightRef.current = event.contentSize.height
      pageViewportHeightRef.current = event.layoutMeasurement.height
      pageReaderMovedUpRef.current = moved < -PAGE_MOVE_SLOP
      const gestureLive = pageGestureLive()
      if (gestureLive) {
        extendPageGesture()
      }
      if (distanceFromTail(event) <= PAGE_MOVE_SLOP) {
        setFollowing(true)
      } else if (gestureLive && pageReaderMovedUpRef.current) {
        // Only the reader detaches: layout (a clamp, rows trimmed or re-measured) moves offsets too.
        setFollowing(false)
      }
      // While following outside a gesture the next pin owns the end.
      setAtTail(endsAtTail || (followingRef.current && !gestureLive))
    },
    [extendPageGesture, pageGestureLive, setAtTail, setFollowing]
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

  useEffect(
    () => () => {
      clearUserScrollSettle()
      clearPageGesture()
    },
    [clearUserScrollSettle, clearPageGesture]
  )

  return {
    listRef,
    listInputProps: {
      ref: attachList,
      onTouchStart: notePageTouches,
      onTouchEnd: notePageTouches,
      onTouchCancel: notePageTouches,
      ...(Platform.OS === 'web' && {
        onWheel: (event) => {
          // Only a move up detaches; a wheel down would just hold pins off.
          if (event.deltaY < 0 && !event.ctrlKey && !event.defaultPrevented) {
            extendPageGesture()
          }
        },
        onKeyDown: (event) => {
          if (isPageScrollKey(event)) {
            extendPageGesture()
          }
        }
      })
    },
    following,
    // The page has no release to snap a reader back to the end, so any detached view offers it.
    showJumpToTail: listReportsGestures() ? !following && !atTail : !following || !atTail,
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
