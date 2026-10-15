import type { PersistedState } from '../../../shared/persisted-state-types'
import type { Repo } from '../../../shared/repo-types'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId
} from '../../../shared/execution-host'
import { isFolderRepo } from '../../../shared/repo-kind'
import { workspaceSessionPartitionHostId } from '../../../shared/workspace-session-partition-owner'
import {
  FOLDER_WORKSPACE_INSTANCE_SEPARATOR,
  getRepoIdFromWorktreeId
} from '../../../shared/worktree/id'
import { findExtraFolderWorkspaceIds } from '../../folder-workspace-meta-presence'
import { getAllWorktreeMetaForHost } from '../loading-store/worktree-identity-metadata'
import {
  addWorkspaceSessionWorktreeOwners,
  getPersistedWorktreeOwnerId
} from '../restoring-sessions/session-worktree-ownership'

export type KindChangeState = Pick<
  PersistedState,
  | 'repos'
  | 'worktreeMeta'
  | 'worktreeMetaByIdentity'
  | 'worktreeIdentityAliases'
  | 'workspaceSession'
  | 'workspaceSessionsByHostId'
>

function sessionWorkspaceIdsForRepo(
  session: WorkspaceSessionState | undefined,
  repoId: string
): Set<string> {
  const ids = new Set<string>()
  if (!session) {
    return ids
  }
  addWorkspaceSessionWorktreeOwners(session, {
    owners: ids,
    addOwner: (ownerKey) => {
      const worktreeId = getPersistedWorktreeOwnerId(ownerKey)
      if (worktreeId && getRepoIdFromWorktreeId(worktreeId) === repoId) {
        ids.add(worktreeId)
      }
    }
  })
  return ids
}

/** Saved-tab owners for this repo, read from the partition its host owns. */
function repoSessionWorkspaceIds(state: KindChangeState, repo: Repo): Set<string> {
  const partition = workspaceSessionPartitionHostId(getRepoExecutionHostId(repo))
  if (partition === LOCAL_EXECUTION_HOST_ID) {
    return sessionWorkspaceIdsForRepo(state.workspaceSession, repo.id)
  }
  const sessions = state.workspaceSessionsByHostId ?? {}
  const ids = sessionWorkspaceIdsForRepo(sessions[partition], repo.id)
  const partitionKind = parseExecutionHostId(partition)?.kind
  // Why: an older build wrote SSH worktrees' rows into the local blob; they are this repo's only
  // when no local row shares its id (repo ids repeat across hosts).
  const hasLocalSibling = state.repos.some(
    (candidate) =>
      candidate.id === repo.id && getRepoExecutionHostId(candidate) === LOCAL_EXECUTION_HOST_ID
  )
  if (partitionKind === 'ssh' && !hasLocalSibling) {
    for (const id of sessionWorkspaceIdsForRepo(state.workspaceSession, repo.id)) {
      ids.add(id)
    }
  }
  // Why: runtime partition ids rotate across relay restarts, so an empty one adopts the unique
  // other partition holding this repo's tabs (the runtime session controller's rule).
  if (partitionKind === 'runtime' && ids.size === 0) {
    const owners: Set<string>[] = []
    for (const [candidate, session] of Object.entries(sessions)) {
      const candidateIds =
        candidate === partition ? null : sessionWorkspaceIdsForRepo(session, repo.id)
      if (candidateIds && candidateIds.size > 0) {
        owners.push(candidateIds)
      }
    }
    return owners.length === 1 ? owners[0]! : ids
  }
  return ids
}

/**
 * Workspaces with saved state that the project's listing stops showing if its type changes. A
 * listing that drops an id purges that workspace's saved tabs, so a non-empty result means the
 * change must be refused. Folder mode lists exactly the root id and the folder-workspace ids, and
 * the purge compares ids as exact strings, so nothing else counts as still shown.
 */
export function findWorkspacesHiddenByKindChange(
  state: KindChangeState,
  repo: Repo,
  nextKind: Repo['kind'] | undefined
): string[] {
  if (nextKind === 'git' && isFolderRepo(repo)) {
    // The folder listing reads this same map, so these are exactly the rows the user sees.
    return findExtraFolderWorkspaceIds(repo, state.worktreeMeta)
  }
  if (nextKind !== 'folder' || isFolderRepo(repo)) {
    return []
  }
  const rootId = `${repo.id}::${repo.path}`
  const ids = repoSessionWorkspaceIds(state, repo)
  for (const worktreeId of Object.keys(
    getAllWorktreeMetaForHost({ state }, getRepoExecutionHostId(repo))
  )) {
    if (getRepoIdFromWorktreeId(worktreeId) === repo.id) {
      ids.add(worktreeId)
    }
  }
  return [...ids].filter(
    (worktreeId) =>
      worktreeId !== rootId &&
      !worktreeId.startsWith(`${rootId}${FOLDER_WORKSPACE_INSTANCE_SEPARATOR}`)
  )
}
