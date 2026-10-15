import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { useAiVaultSessionLaunchActions } from '../right-sidebar/ai-vault-session-launch-actions'

export function useTabSessionLaunchActions(worktreeId: string) {
  const targetState = useAppStore(
    useShallow((state) => ({
      projects: state.projects,
      settings: state.settings,
      folderWorkspaces: state.folderWorkspaces,
      projectGroups: state.projectGroups,
      repos: state.repos,
      worktreesByRepo: state.worktreesByRepo
    }))
  )
  return useAiVaultSessionLaunchActions({
    activeWorktree: null,
    activeWorktreeId: worktreeId,
    targetState,
    agentCmdOverrides: targetState.settings?.agentCmdOverrides
  })
}
