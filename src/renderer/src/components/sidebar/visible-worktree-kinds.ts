import type { ExecutionHostId, ExecutionHostScope } from '../../../../shared/execution-host'
import type { Worktree } from '../../../../shared/worktree/types'

/**
 * The sleeping-sweep exemption and the filter-state shape, split out of visible-worktrees so the
 * filter logic there stays under the line cap. The kind predicates live in shared/worktree/workspace-kinds.
 */

/**
 * Whether the "Hide sleeping" sweep must keep this row (#8873).
 *
 * Why isMainWorktree and not isDefaultBranchWorkspace: the project's primary
 * checkout is the repo's only guaranteed entry point. Detached-HEAD and offline
 * SSH mains fail the default-branch predicate yet often have no sibling row at
 * all, so sweeping them drops the entire project out of the sidebar, Cmd+J and
 * the board with no way back except changing a filter.
 *
 * Why shared: the sidebar pipeline and the jump palette both apply this, and a
 * second copy is how the two surfaces drift.
 */
export function isSleepingSweepExemptWorkspace(
  worktree: Worktree,
  alwaysShowDefaultBranchWorkspace: boolean | undefined
): boolean {
  return alwaysShowDefaultBranchWorkspace !== false && worktree.isMainWorktree
}

/**
 * Whether turning the exemption off is currently narrowing the list. It only
 * bites during the "Hide sleeping" sweep, so its row — and the filter badge on
 * both menu surfaces — ignores it while sleeping workspaces are shown.
 */
export function isSleepingSweepExemptionNarrowingList(
  showSleepingWorkspaces: boolean,
  alwaysShowDefaultBranchWorkspace: boolean | undefined
): boolean {
  return !showSleepingWorkspaces && alwaysShowDefaultBranchWorkspace === false
}

/** Inputs describing sidebar filter settings that the Clear Filters path owns. */
export type SidebarFilterState = {
  showSleepingWorkspaces: boolean
  filterRepoIds: readonly string[]
  hideDefaultBranchWorkspace: boolean
  hideAutomationGeneratedWorkspaces: boolean
  hideCliCreatedWorkspaces: boolean
  hideDetachedHeadWorkspaces: boolean
  hideWorkspacesFromOtherDevices: boolean
  /** Keeps each project's main workspace out of the "Hide sleeping" sweep; absent means on. */
  alwaysShowDefaultBranchWorkspace?: boolean
  visibleWorkspaceHostIds?: readonly ExecutionHostId[] | null
  workspaceHostScope?: ExecutionHostScope
}

/**
 * Whether at least one sidebar filter is active — drives the "Clear Filters"
 * escape hatch in the empty-state message. Kept pure so it can be unit-tested
 * alongside the sorting pipeline.
 *
 * Why include hideDefaultBranchWorkspace here: without it, a user whose only
 * worktree is the default-branch row and who toggles hide-on would see the
 * "No workspaces found" message with no in-sidebar recovery path.
 */
