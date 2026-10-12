import type { ConnectPanePtySession } from './connect-pane-pty-session'
import { runDeferredSessionReattachChoice } from './deferred-session-reattach-choice'
import { connectUnservedSshPaneTarget } from './unserved-ssh-pane-connect'

export function runDeferredSessionAttach(session: ConnectPanePtySession): void {
  if (session.unservedSshTargetId) {
    connectUnservedSshPaneTarget(session, session.unservedSshTargetId)
    return
  }
  runDeferredSessionReattachChoice(session)
}
