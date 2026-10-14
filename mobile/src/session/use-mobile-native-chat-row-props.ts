import { useMemo, useState } from 'react'
import { createNativeChatRowReuse } from '../../../src/shared/native-chat-row-reuse'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileNativeChatTurnRow } from './use-mobile-native-chat-turn-disclosure'

/** Everything a row draws that is particular to it, besides the message itself. */
export type MobileNativeChatRowProps = MobileNativeChatTurnRow & {
  unsentNotice: string | undefined
}

// Why: a streamed batch rebuilds the lookups behind these props, and each settled turn's
// status object with them; reused, `renderItem` and settled rows keep their identity.
const createRowPropsReuse = () => createNativeChatRowReuse<MobileNativeChatRowProps>(1)

/** One row's props: its turn's, plus the line saying why it was not sent. */
export function resolveMobileNativeChatRowProps(
  index: number,
  message: NativeChatMessage,
  resolveTurnRow: (index: number, message: NativeChatMessage) => MobileNativeChatTurnRow,
  unsentNotices: ReadonlyMap<string, string>
): MobileNativeChatRowProps {
  return {
    ...resolveTurnRow(index, message),
    unsentNotice: message.unsent ? unsentNotices.get(message.id) : undefined
  }
}

/** Each listed row's props, by list index. */
export function useMobileNativeChatRowProps(
  listMessages: readonly NativeChatMessage[],
  resolveTurnRow: (index: number, message: NativeChatMessage) => MobileNativeChatTurnRow,
  unsentNotices: ReadonlyMap<string, string>
): readonly MobileNativeChatRowProps[] {
  const [reuseRowProps] = useState(createRowPropsReuse)
  // Why: the view re-renders on every composer keystroke; only row or turn changes need this pass.
  return useMemo(
    () =>
      reuseRowProps(
        listMessages.map((message, index) =>
          resolveMobileNativeChatRowProps(index, message, resolveTurnRow, unsentNotices)
        ),
        (index) => listMessages[index]!.id
      ),
    [reuseRowProps, listMessages, resolveTurnRow, unsentNotices]
  )
}
