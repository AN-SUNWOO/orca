import type { Tab } from '../../../../../shared/tab-types'
import { isStructuredTab } from '@/components/native-chat/structured-agent-session-tabs'
import type { TabsSlice, TabsSliceSet } from './tabs-slice-contract'

/** Marks (a time) or clears (undefined) Sleep on every chat tab of one workspace; the same map when
 *  nothing changes, so a wake that finds no mark writes nothing. */
export function withWorkspaceChatsSleptAt(
  unifiedTabsByWorktree: Record<string, Tab[]>,
  worktreeId: string,
  sleptAt: number | undefined
): Record<string, Tab[]> {
  const tabs = unifiedTabsByWorktree[worktreeId]
  if (!tabs?.some((tab) => isStructuredTab(tab) && tab.sleptAt !== sleptAt)) {
    return unifiedTabsByWorktree
  }
  return {
    ...unifiedTabsByWorktree,
    [worktreeId]: tabs.map((tab) => {
      if (!isStructuredTab(tab) || tab.sleptAt === sleptAt) {
        return tab
      }
      const { sleptAt: _previous, ...awake } = tab
      return sleptAt === undefined ? awake : { ...awake, sleptAt }
    })
  }
}

export function createTabsChatSleepActions(
  set: TabsSliceSet
): Pick<TabsSlice, 'setWorkspaceChatsSleptAt'> {
  return {
    setWorkspaceChatsSleptAt: (worktreeId, sleptAt) => {
      set((state) => {
        const next = withWorkspaceChatsSleptAt(state.unifiedTabsByWorktree, worktreeId, sleptAt)
        return next === state.unifiedTabsByWorktree ? state : { unifiedTabsByWorktree: next }
      })
    }
  }
}
