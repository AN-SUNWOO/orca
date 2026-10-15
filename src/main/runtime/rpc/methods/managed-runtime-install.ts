// The runtime Orca installs for an agent, on the host that receives the call: the one that runs
// that agent's chats. Needs no workspace. Negotiated by `managed-runtime.install.v1`; Remove by
// `managed-runtime.remove.v1`.

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
import { stopStructuredAgentChats } from '../../structured-agent-chat-stop'
import { resolveHostStructuredAgentLaunchEnvironment } from '../../structured-agent-launch-support'
import { isPathInsideOrEqual } from '../../../../shared/cross-platform-path'
import { defineMethod } from '../core'

const installations = new Map<string, ManagedRuntimeInstallation>()

function installationFor(agent: string, runtime: OrcaRuntimeService): ManagedRuntimeInstallation {
  const spec = acpLaunchSpecFor(agent)
  if (!spec?.managedRuntime) {
    throw new Error(`Orca installs no runtime for ${agent}.`)
  }
  const dataDirectory = getProfileUserDataPath()
  const releases = spec.managedRuntime.root(dataDirectory)
  // What a start would run, outside Orca's releases: the launch's own lookup decides.
  const findExternal = async (): Promise<boolean> => {
    const settings = runtime.requireStore().getSettings()
    const env = { ...(await resolveHostStructuredAgentLaunchEnvironment(agent, settings)), ...spec.env }
    try {
      const command = resolveAcpLaunchCommand(spec, env, {
        commandSettings: settings,
        dataDirectory
      })
      return command !== spec.command && !isPathInsideOrEqual(releases, command)
    } catch (error) {
      // An unrunnable Command setting refuses the start itself; it is no copy.
      if (isAgentSessionPreSpawnError(error)) {
        return false
      }
      throw error
    }
  }
  const { launchGate } = spec
  const managedRuntime = spec.managedRuntime
  // Chats, starts, copies, sign-ins and children not proven gone all hold the gate's fence.
  const fence = (work: () => Promise<void>): Promise<void> =>
    launchGate
      ? launchGate.run(() => stopStructuredAgentChats(agent, managedRuntime.label), work)
      : Promise.reject(new Error(`${managedRuntime.label} cannot be removed on this host.`))
  const installation =
    installations.get(agent) ??
    // The chat host's own state root, where its launches look.
    new ManagedRuntimeInstallation(agent, managedRuntime, {
      dataDirectory,
      findExternal,
      fence
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
  }),
  defineMethod({
    name: 'managedRuntime.remove',
    permission: 'host-admin',
    params: ManagedRuntimeAgentParams,
    handler: async ({ agent }, { runtime }) => {
      const installation = installationFor(agent, runtime)
      installation.remove()
      return installation.status()
    }
  })
] as const
