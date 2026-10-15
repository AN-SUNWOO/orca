import { useAppStore } from '@/store'

/** A named pane is required; only launches without one may use default placement. */
export function isAgentLaunchDestinationLive(worktreeId: string, groupId?: string): boolean {
  return (
    groupId === undefined ||
    (useAppStore.getState().groupsByWorktree[worktreeId] ?? []).some(
      (group) => group.id === groupId
    )
  )
}
