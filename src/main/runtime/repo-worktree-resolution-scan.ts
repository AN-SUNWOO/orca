import type { GitWorktreeInfo } from '../../shared/worktree/types'
import { listWorktreesStrict } from '../git/worktree'
import { isLocalWorktreePathMissing } from '../local-worktree-filesystem'
import type { LocalProjectWorktreeGitOptions } from '../project-runtime-git-options'

export type RuntimeWorktreeScanResult =
  | { ok: true; worktrees: GitWorktreeInfo[] }
  | { ok: false; worktrees: GitWorktreeInfo[] }

export async function scanLocalRepoWorktreesForResolution(
  repoPath: string,
  options: LocalProjectWorktreeGitOptions
): Promise<RuntimeWorktreeScanResult> {
  try {
    if (await isLocalWorktreePathMissing(repoPath, options)) {
      return { ok: false, worktrees: [] }
    }
  } catch {
    // A failed host check is not proof of absence; preserve the Git scan's verdict.
  }
  try {
    const worktrees = options.wslDistro
      ? await listWorktreesStrict(repoPath, options)
      : await listWorktreesStrict(repoPath)
    return { ok: true, worktrees }
  } catch {
    return { ok: false, worktrees: [] }
  }
}
