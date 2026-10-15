import { isFolderRepo } from '../repo-kind'
import type { Repo } from '../repo-types'
import { getWorktreeGitIdentityDisplay } from './git-identity-display'
import type { Worktree } from './types'

/**
 * Predicates for what KIND of workspace a row is, as the sidebar's Filters switches classify it.
 *
 * Why shared: main applies the persisted switches to the phone push it sends for local chat
 * sessions, and a second copy of these predicates is how that push drifts from the sidebar.
 */

type WorkspaceKindFields = Pick<
  Worktree,
  | 'isMainWorktree'
  | 'branch'
  | 'head'
  | 'ephemeralVmCheckoutMode'
  | 'automationProvenance'
  | 'cliProvenance'
>

/** Keeps provisioned roots visible because they are the recipe-created workspace, not a source-repo row. */
export function isDefaultBranchWorkspace(
  worktree: Pick<WorkspaceKindFields, 'isMainWorktree' | 'branch' | 'ephemeralVmCheckoutMode'>,
  repo: Pick<Repo, 'kind'> | undefined
): boolean {
  if (!worktree.isMainWorktree || worktree.ephemeralVmCheckoutMode === 'provisioned-root') {
    return false
  }
  // Why: a folder project's root is its default workspace but has no branch; on a git repo an
  // empty branch means detached HEAD or an offline SSH row, which stay visible.
  return worktree.branch.trim() !== '' || (repo !== undefined && isFolderRepo(repo))
}

export function isAutomationGeneratedWorkspace(
  worktree: Pick<WorkspaceKindFields, 'automationProvenance'>
): boolean {
  return worktree.automationProvenance?.kind === 'created-by-automation'
}

export function isCliCreatedWorkspace(
  worktree: Pick<WorkspaceKindFields, 'cliProvenance'>
): boolean {
  return worktree.cliProvenance?.kind === 'created-by-cli'
}

/**
 * Whether a worktree sits on a detached HEAD (a commit, not a branch).
 *
 * Why the head check: folder workspaces and SSH-synthesized rows carry both an
 * empty branch and an empty head, so branch-emptiness alone would sweep them
 * into this filter. Requiring a real head keeps the predicate to genuine
 * detached-HEAD checkouts, matching what DetachedHeadBadge renders on the card.
 */
export function isDetachedHeadWorkspace(
  worktree: Pick<WorkspaceKindFields, 'branch' | 'head'>
): boolean {
  return getWorktreeGitIdentityDisplay(worktree)?.kind === 'detached'
}

/** The Filters switches that hide a workspace by its kind alone, with no live renderer state. */
export type WorkspaceKindSwitches = {
  hideDefaultBranchWorkspace: boolean
  hideAutomationGeneratedWorkspaces: boolean
  hideCliCreatedWorkspaces: boolean
  hideDetachedHeadWorkspaces: boolean
}

export function isHiddenByWorkspaceKindSwitch(
  worktree: WorkspaceKindFields,
  repo: Pick<Repo, 'kind'> | undefined,
  switches: WorkspaceKindSwitches
): boolean {
  return (
    (switches.hideDefaultBranchWorkspace && isDefaultBranchWorkspace(worktree, repo)) ||
    (switches.hideAutomationGeneratedWorkspaces && isAutomationGeneratedWorkspace(worktree)) ||
    (switches.hideCliCreatedWorkspaces && isCliCreatedWorkspace(worktree)) ||
    (switches.hideDetachedHeadWorkspaces && isDetachedHeadWorkspace(worktree))
  )
}
