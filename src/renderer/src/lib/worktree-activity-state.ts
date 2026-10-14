import { tabHasLivePty } from '@/lib/tab-has-live-pty'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import {
  isFreshNonDoneAgentStatus,
  type AgentStatusEntry
} from '../../../shared/agent-status-types'
import { resolveAgentStatusWorktreeId } from './agent-status-worktree-attribution'
import type { Tab } from '../../../shared/tab-types'
import type { ExecutionHostId } from '../../../shared/execution-host'
import { composeWorktreeHostIdentity } from '../../../shared/worktree/host-qualified-identity'

type TerminalLikeTab = Pick<TerminalTab, 'id'>
type BrowserLikeTab = { id: string }

type TabsByWorktree = Record<string, readonly TerminalLikeTab[]>
type PtyIdsByTabId = Record<string, string[]>
type BrowserTabsByWorktree = Record<string, readonly BrowserLikeTab[]>
export type LiveAgentWorktreeStatus = 'working' | 'monitoring' | 'permission'

const EMPTY_WORKTREE_IDS: ReadonlySet<string> = new Set()

/**
 * Worktree ids that currently have a live agent session, derived from the
 * live `agentStatusByPaneKey` map.
 *
 * Why only fresh in-progress rows, plus chats whose host still runs their
 * agent: disconnected SSH and completed headless agents can retain status
 * entries without an open session.
 */
export function getWorktreeIdsWithLiveAgent(
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | null | undefined,
  tabsByWorktree: TabsByWorktree | null | undefined,
  now: number,
  unifiedTabsByWorktree?: Record<string, Tab[]> | null
): Set<string> {
  const rows = Object.values(agentStatusByPaneKey ?? {})
  const otherRows = Object.fromEntries(
    rows.filter((entry) => !entry.structuredHostOwned).map((entry) => [entry.paneKey, entry])
  )
  const worktreeIds = new Set(getLiveAgentStatusByWorktreeId(otherRows, tabsByWorktree, now).keys())
  // A chat's agent outlives its turn, so a done row can still have a running process.
  for (const identity of getWorktreeIdsWithHostOwnedStructuredChat(
    agentStatusByPaneKey,
    unifiedTabsByWorktree
  )) {
    worktreeIds.add(identity)
  }
  return worktreeIds
}

export function getWorktreeIdsWithHostOwnedStructuredChat(
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | null | undefined,
  unifiedTabsByWorktree: Record<string, Tab[]> | null | undefined
): Set<string> {
  const worktreeIds = new Set<string>()
  for (const entry of Object.values(agentStatusByPaneKey ?? {})) {
    if (!entry.structuredHostOwned || !entry.worktreeId) {
      continue
    }
    const tab = unifiedTabsByWorktree?.[entry.worktreeId]?.find(
      (candidate) => candidate.id === entry.tabId && candidate.contentType === 'agent-session'
    )
    if (tab) {
      worktreeIds.add(composeWorktreeHostIdentity(tab.executionHostId, entry.worktreeId))
    } else if (!unifiedTabsByWorktree) {
      worktreeIds.add(entry.worktreeId)
    }
  }
  return worktreeIds
}

export function getLiveAgentStatusByWorktreeId(
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | null | undefined,
  tabsByWorktree: TabsByWorktree | null | undefined,
  now: number
): Map<string, LiveAgentWorktreeStatus> {
  const entries = Object.values(agentStatusByPaneKey ?? {}).filter((entry) =>
    isFreshNonDoneAgentStatus(entry, now)
  )
  if (entries.length === 0) {
    return new Map()
  }
  const worktreeIdByTabId = new Map<string, string>()
  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree ?? {})) {
    for (const tab of tabs) {
      worktreeIdByTabId.set(tab.id, worktreeId)
    }
  }
  const result = new Map<string, LiveAgentWorktreeStatus>()
  for (const entry of entries) {
    const worktreeId = resolveAgentStatusWorktreeId(entry, worktreeIdByTabId)
    if (worktreeId) {
      const status =
        entry.state === 'working'
          ? entry.workingMode === 'monitoring'
            ? 'monitoring'
            : 'working'
          : 'permission'
      const current = result.get(worktreeId)
      if (
        status === 'permission' ||
        current === undefined ||
        (status === 'working' && current === 'monitoring')
      ) {
        result.set(worktreeId, status)
      }
    }
  }
  return result
}

function hasActiveWorkspaceActivity(
  worktreeId: string,
  tabsByWorktree: TabsByWorktree | null | undefined,
  ptyIdsByTabId: PtyIdsByTabId | null | undefined,
  browserTabsByWorktree: BrowserTabsByWorktree | null | undefined,
  worktreeIdsWithLiveAgent: ReadonlySet<string>,
  worktreeIdsWithStructuredChat: ReadonlySet<string> = EMPTY_WORKTREE_IDS,
  executionHostId?: ExecutionHostId
): boolean {
  const tabs = tabsByWorktree?.[worktreeId] ?? []
  const hasLiveTerminal =
    ptyIdsByTabId != null && tabs.some((tab) => tabHasLivePty(ptyIdsByTabId, tab.id))
  const hasBrowser = (browserTabsByWorktree?.[worktreeId] ?? []).length > 0
  // Why: a running agent keeps the workspace visible through brief PTY gaps
  // such as an SSH reconnect or an unmounted remote pane. #7197
  const identity = composeWorktreeHostIdentity(executionHostId, worktreeId)
  const hasLiveAgent =
    worktreeIdsWithLiveAgent.has(worktreeId) || worktreeIdsWithLiveAgent.has(identity)
  // Why not folded into hasLiveTerminal: a structured chat has no PTY and no entry in
  // tabsByWorktree, so every terminal-shaped signal above reads it as absent.
  const hasStructuredChat =
    worktreeIdsWithStructuredChat.has(identity) ||
    worktreeIdsWithStructuredChat.has(composeWorktreeHostIdentity(undefined, worktreeId))
  return hasLiveTerminal || hasBrowser || hasLiveAgent || hasStructuredChat
}

export function isInactiveWorkspace(
  worktreeId: string,
  tabsByWorktree: TabsByWorktree | null | undefined,
  ptyIdsByTabId: PtyIdsByTabId | null | undefined,
  browserTabsByWorktree: BrowserTabsByWorktree | null | undefined,
  worktreeIdsWithLiveAgent: ReadonlySet<string>,
  worktreeIdsWithStructuredChat: ReadonlySet<string> = EMPTY_WORKTREE_IDS,
  executionHostId?: ExecutionHostId
): boolean {
  return !hasActiveWorkspaceActivity(
    worktreeId,
    tabsByWorktree,
    ptyIdsByTabId,
    browserTabsByWorktree,
    worktreeIdsWithLiveAgent,
    worktreeIdsWithStructuredChat,
    executionHostId
  )
}
