/**
 * Adding a WSL distro as a host: admit it, refuse one whose orcad this desktop already reaches,
 * connect (which may boot it), then persist the environment and its WSL record.
 */
import { errorMessage } from '../../shared/error-message'
import { addWslHostEnvironment } from '../../shared/runtime-environment-wsl-host-store'
import type { WslHostDeploymentRecord } from '../../shared/wsl-host-deployment-store'
import { wslHostEnvironmentLabel, type WslHostAddResult } from '../../shared/wsl-host-types'
import { OrcadHostUnsupportedError } from '../orcad/orcad-host-unavailable'
import { admitWslHostDistro, wslHostRunRefusal } from './wsl-host-add-admission'
import type { WslHostConnector, WslHostServiceDependencies } from './wsl-host-service'
import { wslHostSshManagedRefusal } from './wsl-host-ssh-orcad-conflict'
import { WslOrcadLaunchDeferredError, type WslOrcadConnection } from './wsl-orcad-connection'
import { defaultWslOrcadEnvironmentId } from './wsl-orcad-deploy'

/** What registration reads from and reports to the service that owns the hosts. */
export type WslHostRegistrationContext = {
  deps: WslHostServiceDependencies
  /** Throws when this computer has no WSL connector; read at each use, as the service does. */
  wsl: () => WslHostConnector
  recordForDistro: (distro: string) => WslHostDeploymentRecord | null
  recordForEnvironment: (environmentId: string) => WslHostDeploymentRecord | null
  setReady: (record: WslHostDeploymentRecord, connection: WslOrcadConnection) => void
}

export async function registerWslHost(
  context: WslHostRegistrationContext,
  args: { distro: string; startIfStopped?: boolean }
): Promise<WslHostAddResult> {
  const refusal = wslHostRunRefusal(context.deps)
  if (refusal) {
    return refusal
  }
  const admission = admitWslHostDistro({
    requested: args.distro,
    candidates: await context.wsl().listDistros(),
    alreadyAdded: (name) => context.recordForDistro(name) !== null,
    startIfStopped: args.startIfStopped === true
  })
  if (!('distro' in admission)) {
    return admission
  }
  const { distro } = admission
  const userDataPath = context.deps.userDataPath()
  const sharing = await wslHostSshManagedRefusal(distro.name, userDataPath, (name) =>
    context.wsl().readOrcadPublicKey(name)
  )
  if (sharing) {
    return sharing
  }
  const environmentId = defaultWslOrcadEnvironmentId(distro.name)
  let connection: WslOrcadConnection
  try {
    connection = await context.wsl().connect(distro.name)
  } catch (error) {
    if (error instanceof WslOrcadLaunchDeferredError) {
      return { ok: false, kind: 'deferred', message: error.launch.reason }
    }
    return {
      ok: false,
      kind: error instanceof OrcadHostUnsupportedError ? 'unsupported-wsl1' : 'failed',
      message: errorMessage(error)
    }
  }
  try {
    addWslHostEnvironment(userDataPath, {
      id: environmentId,
      name: wslHostEnvironmentLabel(distro.name),
      pairingCode: connection.pairingOffer,
      record: {
        kind: 'wsl',
        distro: distro.name,
        distroId: distro.id,
        localPort: connection.localPort,
        remotePort: connection.remotePort
      }
    })
  } catch (error) {
    await context
      .wsl()
      .disconnect(distro.name)
      .catch(() => {})
    await context
      .wsl()
      .releaseHolder(distro.name)
      .catch(() => {})
    return { ok: false, kind: 'failed', message: errorMessage(error) }
  }
  const record = context.recordForEnvironment(environmentId)
  if (record) {
    context.setReady(record, connection)
  }
  context.deps.ready(environmentId)
  return { ok: true, environmentId }
}
