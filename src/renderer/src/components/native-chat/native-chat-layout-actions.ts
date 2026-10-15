import { flushSync } from 'react-dom'
import type { AppState } from '@/store/types'
import { useAppStore } from '@/store'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import { structuredAgentSessionTargetForHost } from '@/runtime/structured-agent-session-owner'
import { adoptAgentSessionLaunchVerdict } from '@/lib/agent-session-launch-plan'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { beginStructuredAgentSessionProvisionalLaunch } from '@/lib/structured-agent-session-provisional-tab'
import { captureNativeChatComposerFocusIntent } from '@/components/native-chat/use-native-chat-composer-reveal-focus'
import { requestActiveTerminalPaneSplit } from '@/components/tab-bar/request-active-terminal-pane-split'
import type { NativeChatSplitDirection } from './native-chat-split-shortcut'

export type NativeChatSplitTarget =
  | { kind: 'terminal-pane'; terminalTabId: string }
  | { kind: 'workspace-tab'; unifiedTabId: string; groupId: string }

export function resolveActiveNativeChatSplitTarget(
  state: Pick<AppState, 'groupsByWorktree' | 'unifiedTabsByWorktree'>,
  worktreeId: string | null,
  groupId: string | null
): NativeChatSplitTarget | null {
  if (!worktreeId || !groupId) {
    return null
  }
  const group = (state.groupsByWorktree?.[worktreeId] ?? []).find((entry) => entry.id === groupId)
  const tab = (state.unifiedTabsByWorktree?.[worktreeId] ?? []).find(
    (entry) => entry.id === group?.activeTabId && entry.groupId === groupId
  )
  if (tab?.contentType === 'agent-session') {
    return { kind: 'workspace-tab', unifiedTabId: tab.id, groupId }
  }
  if (tab?.contentType === 'terminal' && tab.viewMode === 'chat') {
    return { kind: 'terminal-pane', terminalTabId: tab.entityId }
  }
  return null
}

export function canRunNativeChatSplitTarget(
  state: Pick<AppState, 'groupsByWorktree' | 'unifiedTabsByWorktree'>,
  target: NativeChatSplitTarget | null
): boolean {
  if (!target) {
    return false
  }
  return target.kind === 'terminal-pane' || findSplitSource(state, target) !== null
}

function findSplitSource(
  state: Pick<AppState, 'groupsByWorktree' | 'unifiedTabsByWorktree'>,
  target: Extract<NativeChatSplitTarget, { kind: 'workspace-tab' }>
) {
  for (const [worktreeId, tabs] of Object.entries(state.unifiedTabsByWorktree)) {
    const tab = tabs.find(
      (candidate) => candidate.id === target.unifiedTabId && candidate.groupId === target.groupId
    )
    if (
      tab?.contentType === 'agent-session' &&
      isTuiAgent(tab.agentSessionAgent) &&
      state.groupsByWorktree[worktreeId]?.some((group) => group.id === target.groupId)
    ) {
      return { tab, worktreeId, agent: tab.agentSessionAgent }
    }
  }
  return null
}

export function runNativeChatSplitTarget(
  target: NativeChatSplitTarget,
  direction: NativeChatSplitDirection
): boolean {
  if (target.kind === 'terminal-pane') {
    requestActiveTerminalPaneSplit({
      tabId: target.terminalTabId,
      direction: direction === 'right' ? 'vertical' : 'horizontal'
    })
    return true
  }
  const state = useAppStore.getState()
  const source = findSplitSource(state, target)
  if (!source) {
    return false
  }
  const executionHostId = source.tab.executionHostId
  if (!executionHostId || !structuredAgentSessionTargetForHost(executionHostId)) {
    return false
  }
  const focusIntent = captureNativeChatComposerFocusIntent()
  const groupId = flushSync(() =>
    state.createEmptySplitGroup(source.worktreeId, target.groupId, direction)
  )
  if (!groupId) {
    focusIntent.cancel()
    return false
  }
  // Host admission can outlive this action; the source draft must stop owning keyboard input.
  if (typeof document !== 'undefined') {
    document
      .querySelector<HTMLElement>(`[data-tab-group-body-id="${groupId}"]`)
      ?.focus({ preventScroll: true })
  }
  try {
    const launch = beginStructuredAgentSessionProvisionalLaunch({
      plan: adoptAgentSessionLaunchVerdict({
        route: 'structured-native-chat',
        requestId: newAgentLaunchRequestId(),
        agent: source.agent,
        worktreeId: source.worktreeId,
        executionHostId
      }),
      hooks: {},
      focusIntent,
      onHostDeclined: null,
      targetGroupId: groupId
    })
    if (!launch) {
      state.closeEmptyGroup(source.worktreeId, groupId)
      return false
    }
    // The normal new-chat launch founds an idle conversation; sending starts the agent.
    void launch.settlement.finally(() => state.closeEmptyGroup(source.worktreeId, groupId))
    return true
  } catch (error) {
    state.closeEmptyGroup(source.worktreeId, groupId)
    throw error
  }
}

export function runActiveNativeChatSplit(
  worktreeId: string | null,
  groupId: string | null,
  direction: NativeChatSplitDirection
): boolean {
  const state = useAppStore.getState()
  const target = resolveActiveNativeChatSplitTarget(state, worktreeId, groupId)
  return target ? runNativeChatSplitTarget(target, direction) : false
}
