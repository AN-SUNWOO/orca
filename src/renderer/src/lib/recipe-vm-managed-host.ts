import { isRuntimeOwnedSshTargetId, parseExecutionHostId } from '../../../shared/execution-host'

/** The hidden SSH target of the recipe VM whose managed server is `hostId`, or null. */
export function getRecipeVmSshTargetForHost(
  environments: readonly { id: string; orcadDeployment?: { sshTargetId: string } }[],
  hostId: string | null | undefined
): string | null {
  const host = parseExecutionHostId(hostId)
  if (host?.kind !== 'runtime') {
    return null
  }
  const targetId = environments.find((entry) => entry.id === host.environmentId)?.orcadDeployment
    ?.sshTargetId
  return targetId && isRuntimeOwnedSshTargetId(targetId) ? targetId : null
}
