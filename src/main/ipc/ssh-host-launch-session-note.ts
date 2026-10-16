/** After a managed connect or restore: flags a macOS host whose server outlived its launching SSH session. */
import { getAppEnvironment } from '../../shared/app-environment'
import { listEnvironments } from '../../shared/runtime-environment-store'
import { readManagedOrcadLaunchSshSession } from '../ssh/orcad-managed-launch-session'
import { knownSshHostPlatform } from '../ssh/ssh-host-platform-memo'
import { getSshHostServerStatus } from '../ssh/ssh-host-server-status'
import { connectionManager } from './ssh-ipc-context'
import { publishHostServerStatus } from './runtime-environment-managed-tunnel'

// Once per SSH session: a restore runs on every runtime call, and the answer only changes when
// a session ends, which the next session (a new connection or reconnect generation) checks.
// The ended verdict is kept so a status a later connect replaces gets the warning back. Any
// other verdict expires: another desktop's launching session can end while this one stays.
const checked = new WeakMap<object, { generation: number; ended: boolean; at: number }>()
const RECHECK_MS = 10 * 60_000

/** Never blocks or fails the caller; anything but a proven exit shows nothing. */
export async function noteEndedLaunchSshSession(
  targetId: string,
  environmentId: string,
  now: () => number = Date.now
): Promise<void> {
  // Why the memo: Linux and Windows hosts cost no extra round trip; the tunnel build fills it.
  if (knownSshHostPlatform(targetId)?.os !== 'darwin') {
    return
  }
  const connection = connectionManager?.getConnection(targetId)
  if (!connection) {
    return
  }
  const generation = connection.getConnectGeneration()
  const prior = checked.get(connection)
  if (prior?.generation === generation && (prior.ended || now() - prior.at < RECHECK_MS)) {
    if (prior.ended) {
      flag(targetId, environmentId)
    }
    return
  }
  checked.set(connection, { generation, ended: false, at: now() })
  try {
    const session = await readManagedOrcadLaunchSshSession(
      getAppEnvironment().getPath('userData'),
      environmentId
    )
    // Why: a disconnect, reconnect or unlink during the probe makes its answer someone else's.
    if (
      connectionManager?.getConnection(targetId) !== connection ||
      connection.getConnectGeneration() !== generation
    ) {
      return
    }
    const status = getSshHostServerStatus(targetId)
    if (status?.kind === 'setting-up') {
      // A start or update is still deciding; a later call checks again.
      checked.delete(connection)
      return
    }
    if (session === 'exited') {
      checked.set(connection, { generation, ended: true, at: now() })
      flag(targetId, environmentId)
    }
  } catch (error) {
    console.warn('[ssh] Could not check which SSH session started the managed server:', error)
  }
}

/** A restored host may have no status yet; any other server decision is left alone. */
function flag(targetId: string, environmentId: string): void {
  const userDataPath = getAppEnvironment().getPath('userData')
  if (!listEnvironments(userDataPath).some((entry) => entry.id === environmentId)) {
    return
  }
  const status = getSshHostServerStatus(targetId)
  if (
    !status ||
    (status.kind === 'managed' &&
      status.environmentId === environmentId &&
      !status.serving &&
      !status.launchSessionEnded)
  ) {
    publishHostServerStatus(targetId, {
      ...(status ?? { kind: 'managed', environmentId }),
      launchSessionEnded: true
    })
  }
}

/** After a verified restart: the cached ended verdict no longer describes the host. */
export function forgetLaunchSessionVerdict(targetId: string): void {
  const connection = connectionManager?.getConnection(targetId)
  if (connection) {
    checked.delete(connection)
  }
}
