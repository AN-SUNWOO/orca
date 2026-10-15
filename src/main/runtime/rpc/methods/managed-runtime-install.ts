// The runtime Orca installs for an agent, on the host that receives the call: the one that runs
// that agent's chats. Needs no workspace. Negotiated by `managed-runtime.install.v1`.

import type { OrcaRuntimeService } from '../../orca-runtime'
import {
  ManagedRuntimeAgentParams,
  ManagedRuntimeCancelParams,
  ManagedRuntimeStatusParams
} from '../../../../shared/rpc-contract/managed-runtime-install-params'
import { acpLaunchSpecFor } from '../../../acp/acp-launch-specs'
import { resolveAcpLaunchCommand } from '../../../acp/acp-structured-launch-resolution'
import { ManagedRuntimeInstallation } from '../../../node-runtime/managed-runtime-installation'
import { isAgentSessionPreSpawnError } from '../../../native-chat/agent-session-wire/structured-agent-session-adapter'
import { getProfileUserDataPath } from '../../../orca-profiles/profile-storage-paths'
import { resolveHostStructuredAgentLaunchEnvironment } from '../../structured-agent-launch-support'
import { defineMethod } from '../core'

const installations = new Map<string, ManagedRuntimeInstallation>()

function installationFor(agent: string, runtime: OrcaRuntimeService): ManagedRuntimeInstallation {
  const spec = acpLaunchSpecFor(agent)
  if (!spec?.managedRuntime) {
    throw new Error(`Orca installs no runtime for ${agent}.`)
  }
  const findExternal = async (): Promise<boolean> => {
    const settings = runtime.requireStore().getSettings()
    const env = { ...(await resolveHostStructuredAgentLaunchEnvironment(agent, settings)), ...spec.env }
    try {
      const options = { commandSettings: settings, dataDirectory: null }
      return resolveAcpLaunchCommand(spec, env, options) !== spec.command
    } catch (error) {
      // An unrunnable Command setting refuses the start itself; it is no copy.
      if (isAgentSessionPreSpawnError(error)) {
        return false
      }
      throw error
    }
  }
  const installation =
    installations.get(agent) ??
    // The chat host's own state root, where its launches look.
    new ManagedRuntimeInstallation(agent, spec.managedRuntime, {
      dataDirectory: getProfileUserDataPath(),
      findExternal
    })
  installations.set(agent, installation)
  return installation
}

export const MANAGED_RUNTIME_INSTALL_METHODS = [
  defineMethod({
    name: 'managedRuntime.status',
    permission: 'workspace',
    params: ManagedRuntimeStatusParams,
    handler: async ({ agent, shown }, { runtime, signal }) =>
      installationFor(agent, runtime).status(shown, signal)
  }),
  defineMethod({
    name: 'managedRuntime.install',
    permission: 'host-admin',
    params: ManagedRuntimeAgentParams,
    handler: async ({ agent }, { runtime }) => {
      const installation = installationFor(agent, runtime)
      installation.install()
      return installation.status()
    }
  }),
  defineMethod({
    name: 'managedRuntime.cancel',
    permission: 'host-admin',
    params: ManagedRuntimeCancelParams,
    handler: async ({ agent, operationId }, { runtime }) => {
      const installation = installationFor(agent, runtime)
      installation.cancel(operationId)
      return installation.status()
    }
  })
] as const
