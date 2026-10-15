import {
  Fragment,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ReactElement,
  type Ref
} from 'react'
import { ScrollView, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { styles } from './mobile-native-chat-view-styles'
import type { MobileNativeChatListHandle } from './use-mobile-native-chat-tail-follow'

type Row = { item: NativeChatMessage; index: number }

type Props = {
  ref: Ref<MobileNativeChatListHandle>
  rows: readonly NativeChatMessage[]
  keyOf: (message: NativeChatMessage) => string
  renderItem: (row: Row) => ReactElement
  /** Above the rows: the "Load earlier" control. */
  header: ReactElement | null
  /** Below the rows: the live status, then the messages waiting behind the turn. */
  footer: ReactElement | null
  emptyStateView: ReactElement | null
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
  /** The follow owner's pin, which writes only while following and short of the end. */
  pinToTail: () => void
}

/** The page's transcript: every loaded message in one keyed flow. RN Web's list decides which rows
 *  are drawn by index, after paint, so a chat opened in it climbed to its end, and rows paged in
 *  above a reader had to be drawn somewhere else, where iOS stopped scrolling at the seam. */
export function MobileNativeChatPageList({
  ref,
  rows,
  keyOf,
  renderItem,
  header,
  footer,
  emptyStateView,
  onScroll,
  pinToTail
}: Props): ReactElement {
  const scroll = useRef<ScrollView>(null)
  useImperativeHandle(
    ref,
    () => ({
      scrollToEnd: (params) => scroll.current?.scrollToEnd(params),
      scrollToOffset: ({ offset, animated }) => scroll.current?.scrollTo({ y: offset, animated }),
      getScrollableNode: () => scroll.current?.getScrollableNode()
    }),
    []
  )

  // At commit, so a chat's first paint is at its end; then on every size change of the content or
  // the viewport, which the observer reports after layout and before that frame paints.
  useLayoutEffect(() => {
    pinToTail()
    const observer = new ResizeObserver(() => pinToTail())
    for (const node of [scroll.current?.getScrollableNode(), scroll.current?.getInnerViewNode()]) {
      if (node) {
        observer.observe(node)
      }
    }
    return () => observer.disconnect()
  }, [pinToTail])

  return (
    <ScrollView
      ref={scroll}
      contentContainerStyle={styles.listContent}
      keyboardShouldPersistTaps="handled"
      onScroll={onScroll}
      scrollEventThrottle={32}
    >
      {header}
      {rows.length === 0
        ? emptyStateView
        : rows.map((item, index) => (
            <Fragment key={keyOf(item)}>{renderItem({ item, index })}</Fragment>
          ))}
      {footer}
    </ScrollView>
  )
}
