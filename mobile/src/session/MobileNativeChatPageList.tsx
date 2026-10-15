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
  ref: Ref<MobileNativeChatListHandle>
  endAnchored: boolean
  pin: () => void
  rows: readonly NativeChatMessage[]
  rowKeys: Pick<MobileNativeChatRowKeys, 'scope' | 'keyOf' | 'current'>
  renderItem: (row: Row) => ReactElement
  layoutKey: string
  header: ReactElement | null
  footer: ReactElement | null
  emptyStateView: ReactElement | null
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
}

/** The page's transcript in one keyed flow: RN Web's list draws by index after paint, so opens climbed
 *  and older pages went in its header, where iOS stopped scrolling at the seam. */
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
  // After the handle attaches, so a chat's first paint is at its end.
  useLayoutEffect(() => pin())

  return (
    <MobileNativeChatPageScroll
      ref={scroll}
      endAnchored={endAnchored}
      contentContainerStyle={styles.listContent}
      // Let link/file taps land while the composer keyboard is up
      // instead of being swallowed by the dismiss gesture.
      keyboardShouldPersistTaps="handled"
      onScroll={onScroll}
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
