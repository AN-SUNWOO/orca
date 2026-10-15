// A runtime Orca installs for an agent only when the person asks, as its host reports it.

export type ManagedRuntimeOperation = {
  id: string
  kind: 'install' | 'remove'
  /** `cancelling` from an accepted Cancel until the work unwinds; then `cancelled`, or `succeeded`
   *  when it had already committed. */
  phase:
    | 'downloading'
    | 'extracting'
    | 'verifying'
    | 'removing'
    | 'cancelling'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
  downloadedBytes: number
  totalBytes: number | null
  error?: string
}

export type ManagedRuntimeInstallState = {
  agent: string
  /** Rises with every change the host publishes, across operations. */
  revision: number
  /** The host has a pinned release; without one no Install is offered. */
  available: boolean
  version: string | null
  installedVersion: string | null
  /** False with an installed version: an update is available. */
  installedCurrent: boolean
  /** What a chat start runs now: Orca's release, a copy found outside it, or nothing. */
  source: 'managed' | 'external' | null
  /** The latest operation; an ended one stays readable until the next starts. */
  operation: ManagedRuntimeOperation | null
}
