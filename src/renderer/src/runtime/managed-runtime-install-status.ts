import type { ManagedRuntimeInstallState } from '../../../shared/managed-runtime-install'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import {
  createRevisionedHostStateStore,
  type RevisionedHostSnapshot
} from './revisioned-host-state-store'
import { callRuntimeRpc } from './runtime-rpc-client'

/**
 * What each host says about the runtime it installs for an agent, one entry per host runtime
 * instance and agent, so Settings and a chat read the same answer.
 */

export type ManagedRuntimeInstallSubject = {
  target: RuntimeClientTarget
  /** The paired host's runtime that answers; null for the local runtime. */
  runtimeId: string | null
  agent: string
}

export type ManagedRuntimeInstallSnapshot = RevisionedHostSnapshot<ManagedRuntimeInstallState>

// The host answers a status wait within 25 s; the default remote timeout is shorter.
const STATUS_WAIT_TIMEOUT_MS = 40_000

const hostAgentKey = ({ target, agent }: ManagedRuntimeInstallSubject): string =>
  `${target.kind === 'local' ? '' : target.environmentId}\u0000${agent}`

function callHost(
  subject: ManagedRuntimeInstallSubject,
  method: `managedRuntime.${'status' | 'install' | 'cancel' | 'remove'}`,
  params: Record<string, unknown>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<ManagedRuntimeInstallState> {
  return callRuntimeRpc<ManagedRuntimeInstallState>(
    subject.target,
    method,
    { agent: subject.agent, ...params },
    {
      ...options,
      ...(subject.runtimeId ? { expectedEnvironmentRuntimeId: subject.runtimeId } : {})
    }
  )
}

const installs = createRevisionedHostStateStore<
  ManagedRuntimeInstallSubject,
  ManagedRuntimeInstallState
>({
  key: (subject) => `${hostAgentKey(subject)}\u0000${subject.runtimeId ?? ''}`,
  hostKey: hostAgentKey,
  read: (subject, shown) =>
    callHost(subject, 'managedRuntime.status', shown === undefined ? {} : { shown }, {
      timeoutMs: STATUS_WAIT_TIMEOUT_MS
    })
})

export const readManagedRuntimeInstall = installs.read
export const observeManagedRuntimeInstall = installs.observe
export const wakeManagedRuntimeInstall = installs.wake
export const subscribeManagedRuntimeInstalls = installs.subscribe

/** Starts, or joins, the host's install; rejects with the host's refusal. */
export async function installManagedRuntime(subject: ManagedRuntimeInstallSubject): Promise<void> {
  installs.apply(subject, await callHost(subject, 'managedRuntime.install', {}))
}

export async function cancelManagedRuntimeInstall(
  subject: ManagedRuntimeInstallSubject,
  operationId: string
): Promise<void> {
  installs.apply(subject, await callHost(subject, 'managedRuntime.cancel', { operationId }))
}

/** Starts, or joins, the host's removal; it fails, keeping the files, while anything may run them. */
export async function removeManagedRuntime(subject: ManagedRuntimeInstallSubject): Promise<void> {
  installs.apply(subject, await callHost(subject, 'managedRuntime.remove', {}))
}
