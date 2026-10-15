import { Pressable, Text, View } from 'react-native'
import { ArrowDown, ChevronsDownUp, ChevronsUpDown } from 'lucide-react-native'
import { colors } from '../theme/mobile-theme'
import { styles } from './mobile-native-chat-view-styles'
import { MobileAgentWorkingIndicator } from './MobileAgentWorkingIndicator'

/** Floats over the transcript's bottom-right so the Tools toggle and jump-to-latest take no row. */
export function MobileNativeChatFloatingControls({
  toolCallCount,
  toolsExpanded,
  bridgeWorking,
  onToggleTools,
  showJumpToTail,
  onJumpToTail
}: {
  toolCallCount: number
  toolsExpanded: boolean
  bridgeWorking: boolean
  onToggleTools: () => void
  showJumpToTail: boolean
  onJumpToTail: () => void
}): React.JSX.Element {
  return (
    <View pointerEvents="box-none" style={styles.floatingControls}>
      {bridgeWorking ? (
        <View pointerEvents="none" style={[styles.toolsPill, styles.workingPill]}>
          <MobileAgentWorkingIndicator />
        </View>
      ) : null}
      {toolCallCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={toolsExpanded ? 'Collapse tool runs' : 'Expand tool runs'}
          style={({ pressed }) => [styles.toolsPill, pressed && styles.pressed]}
          onPress={onToggleTools}
        >
          {toolsExpanded ? (
            <ChevronsDownUp size={14} color={colors.textSecondary} strokeWidth={2} />
          ) : (
            <ChevronsUpDown size={14} color={colors.textSecondary} strokeWidth={2} />
          )}
          <Text style={styles.toolsPillLabel}>
            {toolsExpanded ? 'Collapse' : `Tools · ${toolCallCount}`}
          </Text>
        </Pressable>
      ) : null}
      {showJumpToTail ? (
        <Pressable accessibilityLabel="Scroll to latest" style={styles.fab} onPress={onJumpToTail}>
          <ArrowDown size={18} color={colors.textPrimary} strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </View>
  )
}
