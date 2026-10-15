import { isAgentLaunchDestinationLive } from '@/lib/agent-launch-destination'
import { translate } from '../i18n/i18n'
import { clearWebSessionFocusIntentIfMatches } from './web-session-focus-intent'
import { forgetWebSessionTerminalPlacement, webTerminalPlacementParentTabId } from './web-session-terminal-placement'
import type { WebSessionIntentOwner } from './web-session-intent-owner'
import type { CreatedWebRuntimeSessionTerminal } from './web-runtime-session-types'
import {
  restoreActiveWorkspaceSelection,
  type WebRuntimeSessionWorkspaceSelectionRollback
} from './web-runtime-session-workspace-selection'

export async function retireWebRuntimeTerminalForLostDestination(args: {
  strictDestination?: boolean
  worktreeId: string
  targetGroupId?: string
  environmentId: string
  intentOwner: WebSessionIntentOwner
  createdTabId?: string
  workspaceSelectionRollback: WebRuntimeSessionWorkspaceSelectionRollback | null
}): Promise<CreatedWebRuntimeSessionTerminal | null> {
  if (
    !args.strictDestination ||
    isAgentLaunchDestinationLive(args.worktreeId, args.targetGroupId)
  ) {
    return null
  }
  const cleanupFailureMessage = translate(
    'auto.runtime.webRuntimeSession.abandonedTerminalCleanupFailed',
    'The pane closed, but Orca could not confirm its terminal closed on the host.'
  )
  if (args.workspaceSelectionRollback) {
    restoreActiveWorkspaceSelection(args.workspaceSelectionRollback)
  }
  if (!args.createdTabId) {
    return { outcome: { status: 'failed', message: cleanupFailureMessage } }
  }
  const hostTabId = webTerminalPlacementParentTabId(args.createdTabId)
  forgetWebSessionTerminalPlacement({
    environmentId: args.environmentId,
    worktreeId: args.worktreeId,
    hostTabId
  })
  clearWebSessionFocusIntentIfMatches(args.intentOwner, args.worktreeId, args.createdTabId)
  try {
    const { closeWebRuntimeSessionTab } = await import('./web-runtime-session-tab-lifecycle')
    const close = await closeWebRuntimeSessionTab({
      worktreeId: args.worktreeId,
      tabId: hostTabId,
      environmentId: args.environmentId,
      intentOwner: args.intentOwner,
      requireConfirmedClose: true,
      reason: 'user'
    })
    if (close !== 'failed') {
      return { outcome: { status: 'abandoned' } }
    }
  } catch (error) {
    console.warn('[web-runtime-session] terminal retirement failed:', error)
  }
  console.warn('[web-runtime-session] could not retire terminal after its pane closed')
  return { outcome: { status: 'failed', message: cleanupFailureMessage } }
}
