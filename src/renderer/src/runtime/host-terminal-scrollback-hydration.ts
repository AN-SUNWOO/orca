import type { TerminalLayoutSnapshot } from '../../../shared/terminal-tab-types'
import type { SessionReadTerminalScrollbackResult } from '../../../shared/rpc-contract/session-terminal-scrollback-params'
import { SESSION_TERMINAL_SCROLLBACK_READ_RUNTIME_CAPABILITY } from '../../../shared/session-tabs-runtime-capabilities'
import { useAppStore } from '@/store'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { callRuntimeRpc, runtimeEnvironmentSupportsCapability } from './runtime-rpc-client'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'
import { hasRegisteredRuntimeTerminalTab } from './mounted-terminal-tab-registry'

const HOST_SCROLLBACK_READ_TIMEOUT_MS = 10_000

export type HostTerminalScrollbackTabState = {
  layout: TerminalLayoutSnapshot | undefined
  localOnly: Record<string, string> | undefined
}

export type HostTerminalScrollbackHydrationDeps = {
  getTabState: (tabId: string) => HostTerminalScrollbackTabState
  /** Null for a pane this machine runs; such panes never ask a host. */
  resolveEnvironmentId: (worktreeId: string) => string | null
  /** This client's own snapshot store; web clients have none and always answer null. */
  readLocalSnapshot: (ref: string) => string | null
  hostSupportsRead: (environmentId: string) => Promise<boolean>
  readHostSnapshot: (environmentId: string, worktreeId: string, ref: string) => Promise<string>
  isTabMounted: (tabId: string) => boolean
  storeLocalOnly: (tabId: string, buffersByLeafId: Record<string, string>) => void
}

type HostScrollbackLeaf = { leafId: string; ref: string }
type HostScrollbackPlan = { environmentId: string; leaves: HostScrollbackLeaf[] }

const defaultDeps: HostTerminalScrollbackHydrationDeps = {
  getTabState: (tabId) => {
    const state = useAppStore.getState()
    return {
      layout: state.terminalLayoutsByTabId[tabId],
      localOnly: state.localOnlyScrollbackByTabId[tabId]
    }
  },
  resolveEnvironmentId: (worktreeId) =>
    getRuntimeEnvironmentIdForWorktree(useAppStore.getState(), worktreeId),
  readLocalSnapshot: (ref) => {
    try {
      return window.api.session.readTerminalScrollback({ ref })
    } catch {
      return null
    }
  },
  hostSupportsRead: (environmentId) =>
    runtimeEnvironmentSupportsCapability(
      environmentId,
      SESSION_TERMINAL_SCROLLBACK_READ_RUNTIME_CAPABILITY
    ),
  readHostSnapshot: async (environmentId, worktreeId, ref) =>
    (
      await callRuntimeRpc<SessionReadTerminalScrollbackResult>(
        { kind: 'environment', environmentId },
        'session.readTerminalScrollback',
        { worktree: toRuntimeWorktreeSelector(worktreeId), ref },
        { timeoutMs: HOST_SCROLLBACK_READ_TIMEOUT_MS }
      )
    ).buffer,
  isTabMounted: (tabId) => hasRegisteredRuntimeTerminalTab(tabId),
  storeLocalOnly: (tabId, buffersByLeafId) =>
    useAppStore.getState().setTabLocalOnlyScrollback(tabId, buffersByLeafId)
}

// Why: one attempt per pane snapshot per session, so a host that lacks a ref never holds a mount twice.
const attemptedKeys = new Set<string>()
const inFlightByTabId = new Map<string, Promise<void>>()

function attemptKey(environmentId: string, tabId: string, ref: string): string {
  return `${environmentId}\0${tabId}\0${ref}`
}

function planHostScrollbackHydration(
  tabId: string,
  worktreeId: string,
  deps: HostTerminalScrollbackHydrationDeps
): HostScrollbackPlan | null {
  const { layout, localOnly } = deps.getTabState(tabId)
  const refs = Object.entries(layout?.scrollbackRefsByLeafId ?? {})
  if (refs.length === 0) {
    return null
  }
  const environmentId = deps.resolveEnvironmentId(worktreeId)
  if (!environmentId) {
    return null
  }
  const leaves = refs
    .filter(
      ([leafId, ref]) =>
        layout?.buffersByLeafId?.[leafId] === undefined &&
        localOnly?.[leafId] === undefined &&
        !attemptedKeys.has(attemptKey(environmentId, tabId, ref)) &&
        !deps.readLocalSnapshot(ref)
    )
    .map(([leafId, ref]) => ({ leafId, ref }))
  return leaves.length > 0 ? { environmentId, leaves } : null
}

async function fetchHostScrollback(
  tabId: string,
  worktreeId: string,
  plan: HostScrollbackPlan,
  deps: HostTerminalScrollbackHydrationDeps
): Promise<void> {
  for (const leaf of plan.leaves) {
    attemptedKeys.add(attemptKey(plan.environmentId, tabId, leaf.ref))
  }
  if (!(await deps.hostSupportsRead(plan.environmentId).catch(() => false))) {
    return
  }
  const fetched = await Promise.all(
    plan.leaves.map(async (leaf) => ({
      ...leaf,
      buffer: await deps
        .readHostSnapshot(plan.environmentId, worktreeId, leaf.ref)
        .catch(() => null)
    }))
  )
  // Why: a mounted pane's xterm already owns its bytes; its next park captures them instead.
  if (deps.isTabMounted(tabId)) {
    return
  }
  const { layout, localOnly } = deps.getTabState(tabId)
  const next = { ...localOnly }
  let changed = false
  for (const { leafId, ref, buffer } of fetched) {
    if (
      buffer &&
      layout?.scrollbackRefsByLeafId?.[leafId] === ref &&
      layout.buffersByLeafId?.[leafId] === undefined &&
      next[leafId] === undefined
    ) {
      next[leafId] = buffer
      changed = true
    }
  }
  if (changed) {
    deps.storeLocalOnly(tabId, next)
  }
}

/**
 * Starts reading a host-run tab's stored scrollback from its host when this client has no copy,
 * so the pane paints its history after a move deleted (or a web client never had) the local one.
 * Returns null when there is nothing to fetch; the promise never rejects.
 */
export function startHostTerminalScrollbackHydration(
  tabId: string,
  worktreeId: string,
  deps: HostTerminalScrollbackHydrationDeps = defaultDeps
): Promise<void> | null {
  const inFlight = inFlightByTabId.get(tabId)
  if (inFlight) {
    return inFlight
  }
  const plan = planHostScrollbackHydration(tabId, worktreeId, deps)
  if (!plan) {
    return null
  }
  const pending = fetchHostScrollback(tabId, worktreeId, plan, deps)
    .catch(() => {})
    .finally(() => inFlightByTabId.delete(tabId))
  inFlightByTabId.set(tabId, pending)
  return pending
}

export function resetHostTerminalScrollbackHydrationForTests(): void {
  attemptedKeys.clear()
  inFlightByTabId.clear()
}
