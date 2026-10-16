import type { PersistedState } from '../../../shared/persisted-state-types'
import type { Repo } from '../../../shared/repo-types'
import { getRepoExecutionHostId } from '../../../shared/execution-host'
import { isFolderRepo } from '../../../shared/repo-kind'
import {
  FOLDER_WORKSPACE_INSTANCE_SEPARATOR,
  getRepoIdFromWorktreeId
} from '../../../shared/worktree/id'
import { findExtraFolderWorkspaceIds } from '../../folder-workspace-meta-presence'
import { isWorktreeMetaOwnedByRepo } from '../../worktree-metadata-ownership'
import { getAllWorktreeMetaForHost } from '../loading-store/worktree-identity-metadata'

export type KindChangeState = Pick<
  PersistedState,
  'repos' | 'worktreeMeta' | 'worktreeMetaByIdentity' | 'worktreeIdentityAliases'
>

/**
 * Workspaces the project's listing stops showing if its type changes. A listing that drops an id
 * purges that workspace's saved tabs, so a non-empty result means the change must be refused.
 *
 * Git → folder counts this host's worktree records: every worktree a Git listing shows gets one,
 * and the missing-worktree prune keeps any that still has saved tabs, so the records cover every
 * workspace with something to lose. Folder mode lists exactly the root id and the folder-workspace
 * ids, and the purge compares ids as exact strings, so nothing else counts as still shown.
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
  const repoOwnerCount = state.repos.filter((candidate) => candidate.id === repo.id).length
  const hostMeta = getAllWorktreeMetaForHost({ state }, getRepoExecutionHostId(repo))
  return Object.entries(hostMeta)
    .filter(
      ([worktreeId, meta]) =>
        getRepoIdFromWorktreeId(worktreeId) === repo.id &&
        worktreeId !== rootId &&
        !worktreeId.startsWith(`${rootId}${FOLDER_WORKSPACE_INSTANCE_SEPARATOR}`) &&
        isWorktreeMetaOwnedByRepo(repo, meta, repoOwnerCount)
    )
    .map(([worktreeId]) => worktreeId)
}
