import { useCallback, type ComponentProps } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import {
  resolveMobileNativeChatRowProps,
  useMobileNativeChatRowProps,
  type MobileNativeChatRowProps
} from './use-mobile-native-chat-row-props'
import type { MobileNativeChatTurnRow } from './use-mobile-native-chat-turn-disclosure'

type Row = { item: NativeChatMessage; index: number }

// Props every row shares; a change re-renders them all.
type MessageOptions = Pick<
  ComponentProps<typeof MobileNativeChatMessage>,
  'toolsExpanded' | 'fontScale' | 'onOpenFile' | 'structuredActivityUi' | 'onToggleTurn'
>

/** The list's row renderer and the footer's waiting-row renderer, drawing one message element. */
export function useMobileNativeChatRowRenderers(
  listMessages: readonly NativeChatMessage[],
  resolveTurnRow: (index: number, message: NativeChatMessage) => MobileNativeChatTurnRow,
  unsentNotices: ReadonlyMap<string, string>,
  { toolsExpanded, fontScale, onOpenFile, structuredActivityUi, onToggleTurn }: MessageOptions
): {
  renderItem: (row: Row) => React.JSX.Element
  renderWaitingRow: (row: Row) => React.JSX.Element
} {
  const listRowProps = useMobileNativeChatRowProps(listMessages, resolveTurnRow, unsentNotices)
  const renderMessage = useCallback(
    (item: NativeChatMessage, rowProps: MobileNativeChatRowProps | undefined) => (
      <MobileNativeChatMessage
        message={item}
        toolsExpanded={toolsExpanded}
        fontScale={fontScale}
        onOpenFile={onOpenFile}
        structuredActivityUi={structuredActivityUi}
        onToggleTurn={onToggleTurn}
        {...rowProps}
      />
    ),
    [toolsExpanded, fontScale, onOpenFile, structuredActivityUi, onToggleTurn]
  )
  const renderItem = useCallback(
    ({ item, index }: Row) => renderMessage(item, listRowProps[index]),
    [renderMessage, listRowProps]
  )
  // Waiting rows draw in the footer, outside the list's cell reuse.
  const renderWaitingRow = useCallback(
    ({ item, index }: Row) =>
      renderMessage(
        item,
        resolveMobileNativeChatRowProps(index, item, resolveTurnRow, unsentNotices)
      ),
    [renderMessage, resolveTurnRow, unsentNotices]
  )
  return { renderItem, renderWaitingRow }
}
