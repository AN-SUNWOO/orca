import type { Tab } from '../../../../../shared/tab-types'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import { isStructuredTab } from '../../../../../shared/structured-agent-session-tab'
import type { TabsSlice, TabsSliceSet } from './tabs-slice-contract'

type CapturedChat = { tabId: string; sessionId: string; executionHostId?: ExecutionHostId }

/** Sleep only changes chats whose host and session were captured before teardown. */
export function withWorkspaceChatsSleptAt(
  unifiedTabsByWorktree: Record<string, Tab[]>,
  worktreeId: string,
  sleptAt: number | undefined,
  matches: (tab: Tab) => boolean
): Record<string, Tab[]> {
  const tabs = unifiedTabsByWorktree[worktreeId]
  if (!tabs?.some((tab) => isStructuredTab(tab) && matches(tab) && tab.sleptAt !== sleptAt)) {
    return unifiedTabsByWorktree
  }
  return {
    ...unifiedTabsByWorktree,
    [worktreeId]: tabs.map((tab) => {
      if (!isStructuredTab(tab) || !matches(tab) || tab.sleptAt === sleptAt) {
        return tab
      }
      const { sleptAt: _previous, ...awake } = tab
      return sleptAt === undefined ? awake : { ...awake, sleptAt }
    })
  }
}

export function withSelectedHostChatsAwake(
  unifiedTabsByWorktree: Record<string, Tab[]>,
  worktreeId: string,
  executionHostId: ExecutionHostId | undefined
): Record<string, Tab[]> {
  return withWorkspaceChatsSleptAt(
    unifiedTabsByWorktree,
    worktreeId,
    undefined,
    (tab) => tab.executionHostId === executionHostId
  )
}

export function createTabsChatSleepActions(
  set: TabsSliceSet
): Pick<TabsSlice, 'setWorkspaceChatsSleptAt'> {
  return {
    setWorkspaceChatsSleptAt: (worktreeId, chats, sleptAt) => {
      set((state) => {
        const captured = new Map(chats.map((chat: CapturedChat) => [chat.tabId, chat]))
        const next = withWorkspaceChatsSleptAt(
          state.unifiedTabsByWorktree,
          worktreeId,
          sleptAt,
          (tab) => {
            const chat = captured.get(tab.id)
            return chat?.sessionId === tab.entityId && chat.executionHostId === tab.executionHostId
          }
        )
        return next === state.unifiedTabsByWorktree ? state : { unifiedTabsByWorktree: next }
      })
    }
  }
}
