import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { isHiddenByWorkspaceKindSwitch } from '../../../../shared/worktree/workspace-kinds'
import { isInactiveWorkspace } from '@/lib/worktree-activity-state'
import { isSleepingSweepExemptWorkspace } from './visible-worktree-kinds'
import { isWorkspaceOwnedBySomeoneElse } from '../../../../shared/workspace-creator-visibility'
import type { VisibleWorktreeOptions } from './compute-visible-worktrees'

/** The Filters-menu switches; the search box, project and host filters are not among them. */
export type SidebarSwitchInputs = Pick<
  VisibleWorktreeOptions,
  | 'showSleepingWorkspaces'
  | 'alwaysShowDefaultBranchWorkspace'
  | 'tabsByWorktree'
  | 'ptyIdsByTabId'
  | 'browserTabsByWorktree'
  | 'worktreeIdsWithLiveAgent'
  | 'worktreeIdsWithStructuredChat'
  | 'hideDefaultBranchWorkspace'
  | 'hideAutomationGeneratedWorkspaces'
  | 'hideCliCreatedWorkspaces'
  | 'hideDetachedHeadWorkspaces'
  | 'hideWorkspacesFromOtherDevices'
  | 'pairedDeviceIdsByEnvironment'
>

/** Whether a switch in the sidebar's Filters menu hides this git workspace row. */
export function isHiddenBySidebarSwitch(
  worktree: Worktree,
  repo: Repo | undefined,
  inputs: SidebarSwitchInputs
): boolean {
  if (
    inputs.hideWorkspacesFromOtherDevices &&
    isWorkspaceOwnedBySomeoneElse(worktree, inputs.pairedDeviceIdsByEnvironment)
  ) {
    return true
  }
  if (isHiddenByWorkspaceKindSwitch(worktree, repo, inputs)) {
    return true
  }
  // Why no hideDefaultBranchWorkspace term: the kind switch above already won over the exemption.
  return (
    !inputs.showSleepingWorkspaces &&
    !isSleepingSweepExemptWorkspace(worktree, inputs.alwaysShowDefaultBranchWorkspace) &&
    isInactiveWorkspace(
      worktree.id,
      inputs.tabsByWorktree,
      inputs.ptyIdsByTabId,
      inputs.browserTabsByWorktree,
      inputs.worktreeIdsWithLiveAgent,
      inputs.worktreeIdsWithStructuredChat
    )
  )
}
