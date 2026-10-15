import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { MANAGED_RUNTIME_INSTALL_RUNTIME_CAPABILITY } from '../../../shared/managed-runtime-install'
import { lastVerifiedRuntimeStatus } from '../../../shared/runtime-host-status'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import { useAppStore } from '@/store'
import {
  readLocalRuntimeCapabilities,
  subscribeLocalRuntimeCapabilitiesKnown
} from './local-runtime-capabilities'
import {
  observeManagedRuntimeInstall,
  readManagedRuntimeInstall,
  subscribeManagedRuntimeInstalls,
  type ManagedRuntimeInstallSnapshot,
  type ManagedRuntimeInstallSubject
} from './managed-runtime-install-status'
import { useHostStructuredAgent } from './use-host-structured-agent'

export type ManagedRuntimeInstallObservation =
  /** Orca provides no runtime for this agent on this host, or the host cannot install one. */
  | { kind: 'inactive' }
  | {
      kind: 'active'
      subject: ManagedRuntimeInstallSubject
      snapshot: ManagedRuntimeInstallSnapshot
    }

const localInstallCapable = (): boolean =>
  readLocalRuntimeCapabilities().includes(MANAGED_RUNTIME_INSTALL_RUNTIME_CAPABILITY)

/** The install state of the runtime Orca provides for `agent` on the target's host. Follows the
 *  host only while `shown`, so a hidden chat holds no status wait. */
export function useManagedRuntimeInstall(
  target: RuntimeClientTarget,
  agent: string,
  shown: boolean
): ManagedRuntimeInstallObservation {
  const managed = useHostStructuredAgent(target, agent)?.managedRuntime === true
  const environmentId = target.kind === 'environment' ? target.environmentId : null
  const remote = useAppStore((state) =>
    environmentId === null
      ? null
      : lastVerifiedRuntimeStatus(state.runtimeStatusByEnvironmentId.get(environmentId))
  )
  const localCapable = useSyncExternalStore(
    subscribeLocalRuntimeCapabilitiesKnown,
    localInstallCapable,
    localInstallCapable
  )
  const capable =
    environmentId === null
      ? localCapable
      : remote?.capabilities?.includes(MANAGED_RUNTIME_INSTALL_RUNTIME_CAPABILITY) === true
  const runtimeId = remote?.runtimeId ?? null
  const subject = useMemo((): ManagedRuntimeInstallSubject | null => {
    if (!managed || !capable || (environmentId !== null && runtimeId === null)) {
      return null
    }
    const host: RuntimeClientTarget =
      environmentId === null ? { kind: 'local' } : { kind: 'environment', environmentId }
    return { target: host, runtimeId, agent }
  }, [agent, capable, environmentId, managed, runtimeId])
  useEffect(
    () => (subject && shown ? observeManagedRuntimeInstall(subject) : undefined),
    [subject, shown]
  )
  const read = useCallback(() => (subject ? readManagedRuntimeInstall(subject) : null), [subject])
  const snapshot = useSyncExternalStore(subscribeManagedRuntimeInstalls, read, read)
  return useMemo(
    (): ManagedRuntimeInstallObservation =>
      subject && snapshot ? { kind: 'active', subject, snapshot } : { kind: 'inactive' },
    [subject, snapshot]
  )
}
