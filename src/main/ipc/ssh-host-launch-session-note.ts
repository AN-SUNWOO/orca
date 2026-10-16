/** After a managed connect: flags a macOS host whose server outlived its launching SSH session. */
import { getAppEnvironment } from '../../shared/app-environment'
import { readManagedOrcadLaunchSshSession } from '../ssh/orcad-managed-launch-session'
import { knownSshHostPlatform } from '../ssh/ssh-host-platform-memo'
import { getSshHostServerStatus } from '../ssh/ssh-host-server-status'
import { publishHostServerStatus } from './runtime-environment-managed-tunnel'

/** Never blocks or fails the connect; anything but a proven exit shows nothing. */
export async function noteEndedLaunchSshSession(
  targetId: string,
  environmentId: string
): Promise<void> {
  // Why the memo: Linux and Windows hosts cost no extra round trip; the tunnel build fills it.
  if (knownSshHostPlatform(targetId)?.os !== 'darwin') {
    return
  }
  try {
    const session = await readManagedOrcadLaunchSshSession(
      getAppEnvironment().getPath('userData'),
      environmentId
    )
    const status = getSshHostServerStatus(targetId)
    if (
      session === 'exited' &&
      status?.kind === 'managed' &&
      status.environmentId === environmentId &&
      !status.serving
    ) {
      publishHostServerStatus(targetId, { ...status, launchSessionEnded: true })
    }
  } catch (error) {
    console.warn('[ssh] Could not check which SSH session started the managed server:', error)
  }
}
