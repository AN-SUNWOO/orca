import type { RefObject } from 'react'
import type {
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent
} from 'react-native'

export type PageContactDisposition = 'idle' | 'active' | 'released' | 'cancelled'
export type PageScrollKeyEvent = {
  key: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  defaultPrevented?: boolean
  target?: EventTarget | null
  nativeEvent?: { isComposing?: boolean }
}
type PageTouch = { identifier: string | number }
export type PageContactEvent = {
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
    onWheel?: (event: { deltaY: number; ctrlKey: boolean; defaultPrevented?: boolean }) => void
    onKeyDown?: (event: PageScrollKeyEvent) => void
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

/** Distance from the bottom, in points, still treated as "at the tail". */
export const AT_TAIL_SLOP = 80

/** Holds the first visible row in place when rows above it change. The header is not a row. */
const ANCHOR_BELOW_HEADER = { minIndexForVisible: 1 } as const
const ANCHOR_AT_FIRST_ROW = { minIndexForVisible: 0 } as const
export function mobileNativeChatRowAnchor(hasHeader: boolean): { minIndexForVisible: number } {
  return hasHeader ? ANCHOR_BELOW_HEADER : ANCHOR_AT_FIRST_ROW
}

export function distanceFromTail(event: NativeScrollEvent): number {
  const { contentOffset, contentSize, layoutMeasurement } = event
  return contentSize.height - (contentOffset.y + layoutMeasurement.height)
}

export function isAtTail(event: NativeScrollEvent): boolean {
  return distanceFromTail(event) <= AT_TAIL_SLOP
}

const PAGE_SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])
export function isPageScrollKey(event: PageScrollKeyEvent): boolean {
  const editing =
    typeof HTMLElement !== 'undefined' &&
    event.target instanceof HTMLElement &&
    (event.target.isContentEditable || event.target.closest('input, textarea, select') !== null)
  const modified =
    event.altKey || event.ctrlKey || event.metaKey || (event.shiftKey && event.key !== ' ')
  return (
    PAGE_SCROLL_KEYS.has(event.key) &&
    !editing &&
    !modified &&
    !event.defaultPrevented &&
    !event.nativeEvent?.isComposing
  )
}
