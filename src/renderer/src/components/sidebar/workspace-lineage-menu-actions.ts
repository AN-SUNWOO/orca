import { useMemo } from 'react'
import { tabHasLivePty } from '@/lib/tab-has-live-pty'
import type { WorktreeLineage } from '../../../../shared/worktree/lineage-types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { Tab } from '../../../../shared/tab-types'
import type { WorktreeRuntimeOwnerState } from '@/lib/worktree-runtime-owner-state'
import { getWorkspaceDeleteLineage } from './workspace-delete-lineage'
import { resolveWorkspaceChatSleeps, type WorkspaceSleepTarget } from './sleep-workspace-chats'

type WorkspaceActivityMaps = {
  tabsByWorktree: Record<string, { id: string }[]>
  ptyIdsByTabId: Record<string, string[]>
  browserTabsByWorktree: Record<string, { id: string }[]>
  unifiedTabsByWorktree: Record<string, Tab[]>
  chatOwnerState: WorktreeRuntimeOwnerState
}

export type WorkspaceLineageMenuActions = {
  descendants: Worktree[]
  targets: Worktree[]
  sleepableTargets: Worktree[]
}

export function hasSleepableWorkspaceActivity(
  target: WorkspaceSleepTarget,
  {
    tabsByWorktree,
    ptyIdsByTabId,
    browserTabsByWorktree,
    unifiedTabsByWorktree,
    chatOwnerState
  }: WorkspaceActivityMaps
): boolean {
  const worktreeId = typeof target === 'string' ? target : target.id
  const tabs = tabsByWorktree[worktreeId] ?? []
  return (
    tabs.some((tab) => tabHasLivePty(ptyIdsByTabId, tab.id)) ||
    (browserTabsByWorktree[worktreeId] ?? []).length > 0 ||
    resolveWorkspaceChatSleeps({ ...chatOwnerState, unifiedTabsByWorktree }, target).some(
      (chat) => chat.target !== null
    )
  )
}

export function getWorkspaceLineageMenuActions(args: {
  parent: Worktree
  worktrees: readonly Worktree[]
  lineageById: Record<string, WorktreeLineage>
  activity: WorkspaceActivityMaps
}): WorkspaceLineageMenuActions {
  const { descendants } = getWorkspaceDeleteLineage(args.parent, args.worktrees, args.lineageById)
  const targets = [args.parent, ...descendants]
  return {
    descendants,
    targets,
    sleepableTargets: targets.filter((target) =>
      hasSleepableWorkspaceActivity(target, args.activity)
    )
  }
}

const EMPTY_LINEAGE_MENU_ACTIONS: WorkspaceLineageMenuActions = {
  descendants: [],
  targets: [],
  sleepableTargets: []
}

export function useWorkspaceLineageMenuActions(
  args: Parameters<typeof getWorkspaceLineageMenuActions>[0] & { enabled: boolean }
): WorkspaceLineageMenuActions {
  const { enabled, parent, worktrees, lineageById, activity } = args
  const {
    tabsByWorktree,
    ptyIdsByTabId,
    browserTabsByWorktree,
    unifiedTabsByWorktree,
    chatOwnerState
  } = activity
  return useMemo(
    () =>
      enabled
        ? getWorkspaceLineageMenuActions({
            parent,
            worktrees,
            lineageById,
            activity: {
              tabsByWorktree,
              ptyIdsByTabId,
              browserTabsByWorktree,
              unifiedTabsByWorktree,
              chatOwnerState
            }
          })
        : EMPTY_LINEAGE_MENU_ACTIONS,
    [
      browserTabsByWorktree,
      enabled,
      lineageById,
      parent,
      ptyIdsByTabId,
      tabsByWorktree,
      unifiedTabsByWorktree,
      chatOwnerState,
      worktrees
    ]
  )
}
