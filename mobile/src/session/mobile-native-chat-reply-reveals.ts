import { createContext, useMemo, useState } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  createNativeChatReplyRevealTracker,
  trackNativeChatReplyRows,
  type NativeChatReplyReveals
} from '../../../src/shared/native-chat-reply-reveals'

/** Whether the reader asked the OS for reduced motion. Outside a chat, text draws as it arrives. */
export const MobileNativeChatReducedMotionContext = createContext(true)

/** One chat list's reveals. The list holds them, so a row it remounts resumes instead of replaying. */
export function useMobileNativeChatReplyReveals(
  rows: readonly NativeChatMessage[],
  scopeKey: string
): NativeChatReplyReveals {
  const [held] = useState(() => ({ scopeKey, tracker: createNativeChatReplyRevealTracker() }))
  // Row keys are only unique within one chat, so another chat starts its own.
  if (held.scopeKey !== scopeKey) {
    held.scopeKey = scopeKey
    held.tracker = createNativeChatReplyRevealTracker()
  }
  const rowKeys = useMemo(() => rows.map((row) => row.id), [rows])
  const loaded = useMemo(() => new Set(rowKeys), [rowKeys])
  return trackNativeChatReplyRows(held.tracker, rowKeys, loaded)
}
