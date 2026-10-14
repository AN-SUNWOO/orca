// What a start does on this host before it spawns the agent, under the acquisition's signal. Only a
// start prepares: a restart-recovery read and a catalog probe resolve the same launch and never write.

import {
  AgentSessionPreSpawnError,
  type StructuredAgentSessionAcquireInput
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type { AcpStructuredLaunch } from './acp-structured-launch-resolution'
import type { AcpStructuredSessionAdapterDeps } from './acp-structured-session-adapter-deps'

/** The launch a start spawns, prepared; `closedBeforeSpawn` throws once the start was abandoned. */
export function prepareAcpStructuredLaunch(
  deps: Pick<AcpStructuredSessionAdapterDeps, 'spec' | 'resolveLaunch' | 'dataDirectory'>,
  acquire: Pick<StructuredAgentSessionAcquireInput, 'identity' | 'spawnToken' | 'signal'>,
  closedBeforeSpawn: () => void
): Promise<AcpStructuredLaunch> {
  const resolveLaunch = () =>
    deps.resolveLaunch({ identity: acquire.identity, spawnToken: acquire.spawnToken })
  return prepareAcpLaunch(deps, resolveLaunch, acquire.signal, closedBeforeSpawn)
}

/** Any spawn of the agent on this host, a chat's or not: its binary installed, its account ready. */
export async function prepareAcpLaunch<
  Launch extends { command: string; env: Record<string, string> }
>(
  deps: Pick<AcpStructuredSessionAdapterDeps, 'spec' | 'dataDirectory'>,
  resolve: () => Promise<Launch>,
  signal: AbortSignal | undefined,
  closedBeforeSpawn: () => void
): Promise<Launch> {
  const { spec } = deps
  const resolveLaunch = () => resolve().catch(preSpawnFailure)
  let launch = await resolveLaunch()
  closedBeforeSpawn()
  // A missed lookup returns the bare name; a selected Command setting resolves or refuses.
  const { managedRuntime } = spec
  if (managedRuntime && deps.dataDirectory && launch.command === spec.command) {
    await managedRuntime.materialize(deps.dataDirectory, signal).catch(preSpawnFailure)
    closedBeforeSpawn()
    launch = await resolveLaunch()
    closedBeforeSpawn()
  }
  const { prepare } = spec.account
  if (prepare) {
    await prepare(launch.env).catch(preSpawnFailure)
    closedBeforeSpawn()
  }
  return launch
}

function preSpawnFailure(error: unknown): never {
  throw new AgentSessionPreSpawnError(error)
}
