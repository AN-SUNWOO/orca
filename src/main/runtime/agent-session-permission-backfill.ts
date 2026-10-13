import {
  AGENT_CHAT_PERMISSION_MODE_OPTION_ID,
  newChatPermissionMode
} from '../../shared/agent-chat-permission-mode'
import type { AgentSessionStoreTransactions } from './agent-session-store-transactions'

/** One transaction as the chat host installs; before modes, chats ran their own agent's Arguments. */
export function backfillAgentSessionPermissionModes(
  store: AgentSessionStoreTransactions,
  ranWithFullAccess: (provider: string) => boolean
): Promise<void> {
  if (store.readOnly) {
    return Promise.resolve()
  }
  return store.transact((draft) => {
    for (const [sessionId, record] of draft.records) {
      if (record.options?.[AGENT_CHAT_PERMISSION_MODE_OPTION_ID] !== undefined) {
        continue
      }
      const permissionMode = newChatPermissionMode(
        record.provider,
        ranWithFullAccess(record.provider) ? 'full-access' : 'ask'
      )
      if (permissionMode) {
        draft.records.set(sessionId, {
          ...record,
          options: { ...record.options, [AGENT_CHAT_PERMISSION_MODE_OPTION_ID]: permissionMode }
        })
      }
    }
  })
}
