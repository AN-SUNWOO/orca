import { getExecutionHostIdForWorktree } from './worktree-runtime-owner'
import { folderWorkspaceToWorktree } from '../../../shared/folder-workspace-worktree'
import type { Tab } from '../../../shared/tab-types'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { TuiAgent } from '../../../shared/tui-agent'
import { defaultAgentChatLabel } from '../../../shared/agent-session-chat-label'
import { structuredAgentSessionTabId } from '../../../shared/structured-agent-session-projection'
import { insertTabIdIntoOrder } from '../../../shared/workspace-layout/tab-order'
import { useAppStore } from '@/store'
import { ensureGroup } from '@/store/slices/tab-group-state'
import { resolveUnifiedTabCreatePlacement } from '@/store/slices/tabs/tabs-create-placement'
import { findStructuredAgentSessionTab } from './structured-agent-session-tab-activation'
import type { StructuredLaunchSurfaceAddress } from './structured-agent-session-launch-record'
import {
  readStructuredAgentLaunchRecord,
  readStructuredAgentLaunchRecords,
  writeStructuredAgentLaunchRecord
} from './structured-agent-session-launch-persistence'
import { getStructuredLaunchStateBySessionId } from './structured-agent-session-launch-registry'
import {
  structuredAgentSessionFocusOwner,
  structuredAgentSessionTargetForHost
} from '@/runtime/structured-agent-session-owner'
import {
  clearWebSessionFocusIntentIfMatches,
  peekWebSessionFocusIntent,
  resolveWebSessionVisibleTabId
} from '@/runtime/web-session-focus-intent'

type LaunchSurface = {
  sessionId: string
  executionHostId: ExecutionHostId
  agent: TuiAgent
  surfaceAddress?: StructuredLaunchSurfaceAddress
}

export function captureStructuredLaunchSurfaceAddress(
  worktreeId: string,
  targetGroupId?: string
): StructuredLaunchSurfaceAddress {
  const state = useAppStore.getState()
  const groups = state.groupsByWorktree[worktreeId] ?? []
  const placement = resolveUnifiedTabCreatePlacement({
    groups,
    tabs: state.unifiedTabsByWorktree[worktreeId] ?? [],
    activeGroupId: state.activeGroupIdByWorktree[worktreeId],
    targetGroupId,
    lookupWorktrees: () => []
  })
  return {
    worktreeId,
    targetGroupId: placement.groupId,
    precedingTabIds: groups.find((group) => group.id === placement.groupId)?.tabOrder ?? []
  }
}

let stopTrackingSlots: (() => void) | undefined

export function resetStructuredLaunchSurfaceForTests(): void {
  stopTrackingSlots?.()
  stopTrackingSlots = undefined
}

function trackSlotAddresses(): void {
  stopTrackingSlots ??= useAppStore.subscribe((state, previous) => {
    if (state.groupsByWorktree === previous.groupsByWorktree) return
    const records = readStructuredAgentLaunchRecords().filter(
      (record) =>
        record.surfaceAddress &&
        record.executionHostId === 'local' &&
        !state.unifiedTabsByWorktree[record.surfaceAddress.worktreeId]?.some(
          (tab) => tab.id === structuredAgentSessionTabId(record.sessionId)
        )
    )
    if (records.length === 0) resetStructuredLaunchSurfaceForTests()
    for (const record of records) {
      const address = record.surfaceAddress
      if (!address || record.executionHostId !== 'local') continue
      const tabId = structuredAgentSessionTabId(record.sessionId)
      if (state.unifiedTabsByWorktree[address.worktreeId]?.some((tab) => tab.id === tabId)) continue
      if (
        state.groupsByWorktree[address.worktreeId] === previous.groupsByWorktree[address.worktreeId]
      )
        continue
      const group = state.groupsByWorktree[address.worktreeId]?.find((entry) =>
        entry.tabOrder.includes(tabId)
      )
      const surfaceAddress = {
        worktreeId: address.worktreeId,
        targetGroupId: group?.id,
        precedingTabIds: group ? group.tabOrder.slice(0, group.tabOrder.indexOf(tabId)) : []
      }
      const launch = getStructuredLaunchStateBySessionId(record.sessionId)
      if (launch) launch.intent.surfaceAddress = surfaceAddress
      writeStructuredAgentLaunchRecord({ ...record, surfaceAddress })
    }
  })
}

export function reserveStructuredLaunchSlot(launch: LaunchSurface): void {
  const address = launch.surfaceAddress
  if (!address || launch.executionHostId !== 'local') return
  const state = useAppStore.getState()
  const tabId = structuredAgentSessionTabId(launch.sessionId)
  const groups = state.groupsByWorktree[address.worktreeId] ?? []
  if (groups.some((group) => group.tabOrder.includes(tabId))) return
  const { group, groupsByWorktree, activeGroupIdByWorktree } = ensureGroup(
    state.groupsByWorktree,
    state.activeGroupIdByWorktree,
    address.worktreeId,
    groups.some((entry) => entry.id === address.targetGroupId)
      ? address.targetGroupId
      : state.activeGroupIdByWorktree[address.worktreeId]
  )
  // Only reload reconstructs a missing slot; live sibling mutations use canonical order.
  const preceding = new Set(address.precedingTabIds)
  const anchor = group.tabOrder.findLast((id) => preceding.has(id))
  const order = insertTabIdIntoOrder(
    group.tabOrder,
    state.unifiedTabsByWorktree[address.worktreeId] ?? [],
    tabId,
    false,
    anchor
  )
  if (!anchor && address.precedingTabIds.length === 0) {
    order.splice(order.indexOf(tabId), 1)
    const firstUnpinned = order.findIndex(
      (id) =>
        !state.unifiedTabsByWorktree[address.worktreeId]?.find((tab) => tab.id === id)?.isPinned
    )
    order.splice(firstUnpinned < 0 ? order.length : firstUnpinned, 0, tabId)
  }
  trackSlotAddresses()
  useAppStore.setState({
    groupsByWorktree: {
      ...groupsByWorktree,
      [address.worktreeId]: groupsByWorktree[address.worktreeId].map((entry) =>
        entry.id === group.id ? { ...entry, tabOrder: order } : entry
      )
    },
    activeGroupIdByWorktree,
    layoutByWorktree: {
      ...state.layoutByWorktree,
      [address.worktreeId]: state.layoutByWorktree[address.worktreeId] ?? {
        type: 'leaf',
        groupId: group.id
      }
    }
  })
}

export function removeStructuredLaunchSlot(worktreeId: string, sessionId: string): void {
  const state = useAppStore.getState()
  const tabId = structuredAgentSessionTabId(sessionId)
  if (state.unifiedTabsByWorktree[worktreeId]?.some((tab) => tab.id === tabId)) return
  const groups = state.groupsByWorktree[worktreeId] ?? []
  if (!groups.some((group) => group.tabOrder.includes(tabId))) return
  useAppStore.setState({
    groupsByWorktree: {
      ...state.groupsByWorktree,
      [worktreeId]: groups.map((group) => ({
        ...group,
        tabOrder: group.tabOrder.filter((id) => id !== tabId)
      }))
    }
  })
}

export function openStructuredAgentSessionProvisionalTab(args: {
  worktreeId: string
  executionHostId: ExecutionHostId
  sessionId: string
  agent: TuiAgent
  targetGroupId?: string
  activate?: boolean
}): Tab {
  const state = useAppStore.getState()
  const target = structuredAgentSessionTargetForHost(args.executionHostId)
  const existing = findStructuredAgentSessionTab(state.unifiedTabsByWorktree, {
    workspaceId: args.worktreeId,
    sessionId: args.sessionId,
    ...(target ? { target } : {})
  })
  if (existing) {
    if (args.activate !== false) {
      state.focusGroup(args.worktreeId, existing.groupId)
      state.activateTab(existing.id, { worktreeId: args.worktreeId })
      state.setActiveTabType('agent-session', args.worktreeId)
    }
    return existing
  }
  const tabId = structuredAgentSessionTabId(args.sessionId)
  const record = readStructuredAgentLaunchRecord(args.sessionId)
  const address =
    record?.executionHostId === args.executionHostId ? record.surfaceAddress : undefined
  const group = state.groupsByWorktree?.[args.worktreeId]?.find((entry) =>
    entry.tabOrder.includes(tabId)
  )
  const tab = state.createUnifiedTab(args.worktreeId, 'agent-session', {
    id: tabId,
    entityId: args.sessionId,
    executionHostId: args.executionHostId,
    agentSessionAgent: args.agent,
    label: defaultAgentChatLabel(args.agent),
    targetGroupId:
      group?.id ??
      (address?.worktreeId === args.worktreeId ? address.targetGroupId : args.targetGroupId),
    activate: args.activate !== false
  })
  if (args.activate !== false) state.setActiveTabType('agent-session', args.worktreeId)
  return tab
}

export function materializeStructuredLaunchSurface(launch: LaunchSurface, activate?: false): void {
  const address = launch.surfaceAddress
  if (!address || launch.executionHostId !== 'local') return
  const state = useAppStore.getState()
  const owner = structuredAgentSessionFocusOwner({ kind: 'local' })
  const hostTabId = `agent-session:${launch.sessionId}`
  const focus = peekWebSessionFocusIntent(owner, address.worktreeId)
  openStructuredAgentSessionProvisionalTab({
    ...launch,
    worktreeId: address.worktreeId,
    activate:
      activate !== false &&
      focus?.hostTabId === hostTabId &&
      (focus.expectedCurrentLocalTabId === undefined ||
        focus.expectedCurrentLocalTabId ===
          resolveWebSessionVisibleTabId(state, address.worktreeId))
  })
  if (activate !== false) clearWebSessionFocusIntentIfMatches(owner, address.worktreeId, hostTabId)
}

export function restoreStructuredLaunchSurfaces(): void {
  const state = useAppStore.getState()
  const validWorkspaces = new Set([
    ...state.allWorktrees().map((worktree) => worktree.id),
    ...state.folderWorkspaces.map((workspace) => folderWorkspaceToWorktree(workspace).id)
  ])
  for (const record of readStructuredAgentLaunchRecords()) {
    if (
      record.executionHostId !== 'local' ||
      record.lifecycle !== 'visibility-unknown' ||
      !record.surfaceAddress ||
      !validWorkspaces.has(record.surfaceAddress.worktreeId) ||
      getExecutionHostIdForWorktree(state, record.surfaceAddress.worktreeId) !== 'local'
    )
      continue
    reserveStructuredLaunchSlot(record)
    materializeStructuredLaunchSurface(record, false)
  }
}
