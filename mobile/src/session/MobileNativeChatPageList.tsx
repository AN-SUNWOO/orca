import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ReactElement,
  type Ref
} from 'react'
import {
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
  type ViewStyle
} from 'react-native'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileNativeChatRowKeys } from './mobile-native-chat-row-keys'
import { styles } from './mobile-native-chat-view-styles'
import { MobileNativeChatPageScroll } from './MobileNativeChatPageScroll'
import type { MobileNativeChatListHandle } from './use-mobile-native-chat-tail-follow'
import {
  MOBILE_NATIVE_CHAT_WINDOW_ID,
  useMobileNativeChatPageWindow,
  type MobileNativeChatWindowScroller
} from './use-mobile-native-chat-page-window'

type Row = { item: NativeChatMessage; index: number }

type Props = {
  /** The follow owner's attachment: it scrolls through this and watches the list resize. */
  ref: Ref<MobileNativeChatListHandle>
  /** Whether the reader follows the end. */
  endAnchored: boolean
  /** The follow owner's end pin, which writes only while following and short of the end. */
  pin: () => void
  rows: readonly NativeChatMessage[]
  rowKeys: Pick<MobileNativeChatRowKeys, 'scope' | 'keyOf' | 'current'>
  renderItem: (row: Row) => ReactElement
  /** Changes when every row's height may: the font scale, the Tools toggle. */
  layoutKey: string
  /** Above the rows: the "Load earlier" control. */
  header: ReactElement | null
  /** Below the rows: the live status, then the messages waiting behind the turn. */
  footer: ReactElement | null
  emptyStateView: ReactElement | null
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
}

/** The page's transcript in one keyed flow, drawing only the messages near the screen. RN Web's list
 *  decides which rows are drawn by index, after paint, so a chat opened in it climbed to its end, and
 *  rows paged in above a reader had to be drawn somewhere else, where iOS stopped scrolling at the
 *  seam. */
export function MobileNativeChatPageList({
  ref,
  endAnchored,
  pin,
  rows,
  rowKeys,
  renderItem,
  layoutKey,
  header,
  footer,
  emptyStateView,
  onScroll
}: Props): ReactElement {
  const scroll = useRef<ScrollView>(null)
  const scroller = useCallback(
    (): MobileNativeChatWindowScroller | null | undefined => scroll.current?.getScrollableNode(),
    []
  )
  const view = useMobileNativeChatPageWindow({
    rows,
    rowKeys,
    following: endAnchored,
    layoutKey,
    scroller
  })
  const { cover, keepInPlace } = view
  useImperativeHandle(
    ref,
    () => ({
      getScrollableNode: () => scroll.current?.getScrollableNode(),
      scrollToOffset: ({ offset, animated }) => scroll.current?.scrollTo({ y: offset, animated }),
      scrollToEnd: (params) => scroll.current?.scrollToEnd(params),
      afterResize: cover,
      keepInPlace
    }),
    [cover, keepInPlace]
  )
  // At every commit, once the owner holds this list: a chat's first paint is at its end.
  useLayoutEffect(() => pin())
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    onScroll(event)
    view.onScroll()
  }

  return (
    <MobileNativeChatPageScroll
      ref={scroll}
      endAnchored={endAnchored}
      contentContainerStyle={styles.listContent}
      // Let link/file taps land while the composer keyboard is up
      // instead of being swallowed by the dismiss gesture.
      keyboardShouldPersistTaps="handled"
      onScroll={handleScroll}
      scrollEventThrottle={32}
    >
      {header}
      {rows.length === 0 ? (
        emptyStateView
      ) : (
        <View testID={MOBILE_NATIVE_CHAT_WINDOW_ID}>
          <View style={[pageList.spacer, { height: view.top }]} />
          {rows.slice(view.start, view.end).map((item, at) => (
            <View key={rowKeys.keyOf(item)}>{renderItem({ item, index: view.start + at })}</View>
          ))}
          <View style={[pageList.spacer, { height: view.bottom }]} />
        </View>
      )}
      {footer}
    </MobileNativeChatPageScroll>
  )
}

// Spacers stay out of the browser's scroll anchoring, so a drawn row is its anchor.
const spacer: ViewStyle & { overflowAnchor: 'none' } = { overflowAnchor: 'none' }

const pageList = StyleSheet.create({ spacer })
