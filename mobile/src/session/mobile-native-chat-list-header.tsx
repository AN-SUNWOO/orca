import type { ReactElement } from 'react'
import { ActivityIndicator, Pressable, Text } from 'react-native'
import { colors } from '../theme/mobile-theme'
import { styles } from './mobile-native-chat-view-styles'

const LOAD_EARLIER_FAILED = "Couldn't load earlier messages. Tap to try again."

/** The "Load earlier messages" control, while older history remains. */
export function mobileNativeChatListHeader(
  hasMore: boolean | undefined,
  loadingEarlier: boolean | undefined,
  loadEarlierFailed: boolean | undefined,
  loadEarlier: () => void
): ReactElement | null {
  if (!hasMore) {
    return null
  }
  return (
    <Pressable style={styles.loadEarlier} onPress={loadEarlier} disabled={loadingEarlier}>
      {loadingEarlier ? (
        <ActivityIndicator size="small" color={colors.textMuted} />
      ) : (
        <Text style={styles.loadEarlierText}>Load earlier messages</Text>
      )}
      {loadEarlierFailed && !loadingEarlier ? (
        <Text style={styles.loadEarlierFailedText}>{LOAD_EARLIER_FAILED}</Text>
      ) : null}
    </Pressable>
  )
}
