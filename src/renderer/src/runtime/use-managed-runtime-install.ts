import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { isAgentSessionHandleProvider } from '../../../shared/agent-session-provider-handle'
import { LOCAL_EXECUTION_HOST_ID, toRuntimeExecutionHostId } from '../../../shared/execution-host'
import { MANAGED_RUNTIME_INSTALL_RUNTIME_CAPABILITY } from '../../../shared/managed-runtime-install'
import { lastVerifiedRuntimeStatus } from '../../../shared/runtime-host-status'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import { useAppStore } from '@/store'
import {
  hostStructuredAgentsReadFailed,
  subscribeHostStructuredAgents
} from './host-structured-agents'
import {
  readLocalRuntimeCapabilitiesOrUnknown,
  subscribeLocalRuntimeCapabilitiesKnown
} from './local-runtime-capabilities'
import {
  observeManagedRuntimeInstall,
  readManagedRuntimeInstall,
  subscribeManagedRuntimeInstalls,
  wakeManagedRuntimeInstall,
  type ManagedRuntimeInstallSnapshot,
  type ManagedRuntimeInstallSubject
} from './managed-runtime-install-status'
import { useHostStructuredAgent } from './use-host-structured-agent'

export type ManagedRuntimeInstallObservation =
  /** Orca provides no runtime for this agent on this host, or the host cannot install one. */
  | { kind: 'inactive' }
  /** The host's capabilities or agent list have not loaded, so neither is known yet. */
  | { kind: 'pending' }
  | {
      kind: 'active'
      subject: ManagedRuntimeInstallSubject
      snapshot: ManagedRuntimeInstallSnapshot
    }

const INACTIVE: ManagedRuntimeInstallObservation = { kind: 'inactive' }
const PENDING: ManagedRuntimeInstallObservation = { kind: 'pending' }
const READ_FAILED: ManagedRuntimeInstallSnapshot = { kind: 'readFailed' }

/** Null while the local runtime has not reported its capabilities. */
const localInstallCapable = (): boolean | null =>
  readLocalRuntimeCapabilitiesOrUnknown()?.includes(MANAGED_RUNTIME_INSTALL_RUNTIME_CAPABILITY) ??
  null

/** The install state of the runtime Orca provides for `agent` on the target's host. Follows the
 *  host only while `shown`, so a hidden chat holds no status wait. */
export function useManagedRuntimeInstall(
  target: RuntimeClientTarget,
  agent: string,
  shown: boolean
): ManagedRuntimeInstallObservation {
  const record = useHostStructuredAgent(target, agent)
  const managed = record?.managedRuntime === true
  const environmentId = target.kind === 'environment' ? target.environmentId : null
  const remote = useAppStore((state) =>
    environmentId === null
      ? null
      : lastVerifiedRuntimeStatus(state.runtimeStatusByEnvironmentId.get(environmentId))
  )
  const contactEpoch = useAppStore((state) =>
    environmentId === null
      ? 0
      : (state.runtimeStatusByEnvironmentId.get(environmentId)?.hostContactEpoch ?? 0)
  )
  const localCapable = useSyncExternalStore(
    subscribeLocalRuntimeCapabilitiesKnown,
    localInstallCapable,
    localInstallCapable
  )
  const capable =
    environmentId === null
      ? localCapable
      : remote && remote.capabilities?.includes(MANAGED_RUNTIME_INSTALL_RUNTIME_CAPABILITY) === true
  const runtimeId = remote?.runtimeId ?? null
  const executionHostId =
    environmentId === null ? LOCAL_EXECUTION_HOST_ID : toRuntimeExecutionHostId(environmentId)
  const readListFailed = useCallback(
    () => hostStructuredAgentsReadFailed(executionHostId, runtimeId),
    [executionHostId, runtimeId]
  )
  const listFailed = useSyncExternalStore(
    subscribeHostStructuredAgents,
    readListFailed,
    readListFailed
  )
  const subject = useMemo((): ManagedRuntimeInstallSubject | null => {
    if (!capable || (environmentId !== null && runtimeId === null)) {
      return null
    }
    const host: RuntimeClientTarget =
      environmentId === null ? { kind: 'local' } : { kind: 'environment', environmentId }
    return { target: host, runtimeId, agent }
  }, [agent, capable, environmentId, runtimeId])
  useEffect(
    () => (subject && managed && shown ? observeManagedRuntimeInstall(subject) : undefined),
    [subject, managed, shown]
  )
  // The host answering again after an outage retries a failed read at once, not after its backoff.
  useEffect(() => {
    if (subject) {
      wakeManagedRuntimeInstall(subject)
    }
  }, [subject, contactEpoch])
  const read = useCallback(() => (subject ? readManagedRuntimeInstall(subject) : null), [subject])
  const snapshot = useSyncExternalStore(subscribeManagedRuntimeInstalls, read, read)
  return useMemo((): ManagedRuntimeInstallObservation => {
    if (capable === false || (record && !managed)) {
      return INACTIVE
    }
    if (subject && managed && snapshot) {
      return { kind: 'active', subject, snapshot }
    }
    // A failed list leaves the chat's composer and the host's refusal, and Settings says so.
    if (subject && listFailed) {
      return { kind: 'active', subject, snapshot: READ_FAILED }
    }
    // Claude and Codex run the program every build ships, so they never wait on the host's list.
    return isAgentSessionHandleProvider(agent) ? INACTIVE : PENDING
  }, [agent, capable, listFailed, managed, record, snapshot, subject])
}
