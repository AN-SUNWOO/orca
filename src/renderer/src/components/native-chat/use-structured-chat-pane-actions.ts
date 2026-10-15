import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { useTabGroupTabCloseCommands } from '../tab-group/useTabGroupTabCloseCommands'
import { useTabGroupCloseScopeCommands } from '../tab-group/useTabGroupCloseScopeCommands'
import { runNativeChatSplitTarget } from './native-chat-layout-actions'
import type { Tab, TabGroup } from '../../../../shared/tab-types'

const EMPTY_TABS: Tab[] = []
const EMPTY_GROUPS: TabGroup[] = []

export function useStructuredChatPaneActions(tabId: string, worktreeId: string, groupId: string) {
  const tabs = useAppStore((state) => state.unifiedTabsByWorktree[worktreeId] ?? EMPTY_TABS)
  const groups = useAppStore((state) => state.groupsByWorktree[worktreeId] ?? EMPTY_GROUPS)
  const groupTabs = useMemo(() => tabs.filter((tab) => tab.groupId === groupId), [tabs, groupId])
  const { closeItem, closeMany } = useTabGroupTabCloseCommands({ worktreeId })
  const { closeGroup } = useTabGroupCloseScopeCommands({
    worktreeId, groupId, groupTabs, group: groups.find((group) => group.id === groupId) ?? null,
    closeItem, closeMany
  })
  return {
    onSplitRight: () => runNativeChatSplitTarget({ kind: 'workspace-tab', unifiedTabId: tabId, groupId }, 'right'),
    onSplitDown: () => runNativeChatSplitTarget({ kind: 'workspace-tab', unifiedTabId: tabId, groupId }, 'down'),
    canClosePane: groups.length > 1,
    onClosePane: closeGroup
  }
}
