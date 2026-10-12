import type { SshTarget } from '../../shared/ssh-types'
import type { RemoteInstallTransport } from './remote-install-transport'

/** The host connection orcad deploy, activation, serving and lifecycle code runs over. */
export type OrcadHostTransport = RemoteInstallTransport & {
  /** Keys per-host state (remote context, wake dedupe) to the target it reaches. */
  getTarget(): SshTarget
}
