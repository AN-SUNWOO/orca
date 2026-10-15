import type { Ref } from 'react'
import { ScrollView, StyleSheet, View, type ScrollViewProps, type ViewStyle } from 'react-native'

/** The page's scroller: the transcript in one wrapper, then a 1 px end marker. While the reader
 *  follows, the wrapper is out of the browser's scroll anchoring, so the marker is its anchor and
 *  trimming a row above can't scroll the view off the end. */
export function MobileNativeChatPageScroll({
  ref,
  children,
  contentContainerStyle,
  endAnchored,
  ...props
}: ScrollViewProps & { ref?: Ref<ScrollView>; endAnchored: boolean }) {
  return (
    <ScrollView ref={ref} {...props} contentContainerStyle={pageScroll.fill}>
      <View style={[contentContainerStyle, endAnchored && pageScroll.outOfAnchoring]}>
        {children}
      </View>
      <View style={pageScroll.endMarker} />
    </ScrollView>
  )
}

// RN Web passes it through to CSS; ViewStyle doesn't name it.
const outOfAnchoring: ViewStyle & { overflowAnchor: 'none' } = { overflowAnchor: 'none' }

const pageScroll = StyleSheet.create({
  fill: { flexGrow: 1 },
  outOfAnchoring,
  endMarker: { height: 1 }
})
