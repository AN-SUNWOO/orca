import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalLayoutSnapshot } from '../../../shared/terminal-tab-types'
import {
  resetHostTerminalScrollbackHydrationForTests,
  startHostTerminalScrollbackHydration,
  type HostTerminalScrollbackHydrationDeps,
  type HostTerminalScrollbackTabState
} from './host-terminal-scrollback-hydration'
import { createWebWorkspaceSessionApi } from '../web/preload-api/web-workspace-session-api'

vi.mock('@/store', () => ({ useAppStore: { getState: vi.fn() } }))
vi.mock('../web/preload-api/web-runtime-session', () => ({
  requireActiveEnvironmentOrNull: () => null
}))

const REF = `v1-${'c'.repeat(32)}`

function layout(overrides: Partial<TerminalLayoutSnapshot> = {}): TerminalLayoutSnapshot {
  return {
    root: { type: 'leaf', leafId: 'leaf-1' },
    activeLeafId: 'leaf-1',
    expandedLeafId: null,
    scrollbackRefsByLeafId: { 'leaf-1': REF },
    ...overrides
  }
}

function harness(overrides: Partial<HostTerminalScrollbackHydrationDeps> = {}) {
  const tabState: HostTerminalScrollbackTabState = { layout: layout(), localOnly: undefined }
  const deps = {
    getTabState: vi.fn(() => tabState),
    resolveEnvironmentId: vi.fn((_worktreeId: string): string | null => 'env-wsl'),
    readLocalSnapshot: vi.fn((_ref: string): string | null => null),
    hostSupportsRead: vi.fn(async (_environmentId: string) => true),
    readHostSnapshot: vi.fn(
      async (_environmentId: string, _worktreeId: string, _ref: string) => 'host history'
    ),
    isTabMounted: vi.fn((_tabId: string) => false),
    storeLocalOnly: vi.fn((tabId: string, buffers: Record<string, string>) => {
      void tabId
      tabState.localOnly = buffers
    }),
    ...overrides
  }
  return { deps, tabState }
}

beforeEach(() => {
  resetHostTerminalScrollbackHydrationForTests()
})

describe('startHostTerminalScrollbackHydration', () => {
  it('reads a host-run pane from its host when this client has no copy', async () => {
    const { deps, tabState } = harness()
    await startHostTerminalScrollbackHydration('tab-1', 'repo::/wt', deps)
    expect(deps.hostSupportsRead).toHaveBeenCalledWith('env-wsl')
    expect(deps.readHostSnapshot).toHaveBeenCalledExactlyOnceWith('env-wsl', 'repo::/wt', REF)
    expect(tabState.localOnly).toEqual({ 'leaf-1': 'host history' })
  })

  it('does nothing new when the host does not advertise the read', async () => {
    const { deps, tabState } = harness({ hostSupportsRead: vi.fn(async () => false) })
    await startHostTerminalScrollbackHydration('tab-1', 'repo::/wt', deps)
    expect(deps.readHostSnapshot).not.toHaveBeenCalled()
    expect(tabState.localOnly).toBeUndefined()
  })

  it('never asks a host for a pane this machine runs', () => {
    const { deps } = harness({ resolveEnvironmentId: vi.fn(() => null) })
    expect(startHostTerminalScrollbackHydration('tab-1', 'repo::/wt', deps)).toBeNull()
    expect(deps.hostSupportsRead).not.toHaveBeenCalled()
    expect(deps.readLocalSnapshot).not.toHaveBeenCalled()
  })

  it('keeps using the local copy when this client still has one', () => {
    const { deps } = harness({ readLocalSnapshot: vi.fn(() => 'local history') })
    expect(startHostTerminalScrollbackHydration('tab-1', 'repo::/wt', deps)).toBeNull()
    expect(deps.hostSupportsRead).not.toHaveBeenCalled()
  })

  it('skips leaves that already carry bytes', () => {
    const { deps, tabState } = harness()
    tabState.layout = layout({ buffersByLeafId: { 'leaf-1': 'shared' } })
    expect(startHostTerminalScrollbackHydration('tab-1', 'repo::/wt', deps)).toBeNull()
    tabState.layout = layout()
    tabState.localOnly = { 'leaf-1': 'parked' }
    expect(startHostTerminalScrollbackHydration('tab-1', 'repo::/wt', deps)).toBeNull()
  })

  it('tries each snapshot once and shares an in-flight read', async () => {
    const { deps } = harness({
      readHostSnapshot: vi.fn(async (): Promise<string> => {
        throw new Error('host unreachable')
      })
    })
    const first = startHostTerminalScrollbackHydration('tab-1', 'repo::/wt', deps)
    expect(startHostTerminalScrollbackHydration('tab-1', 'repo::/wt', deps)).toBe(first)
    await first
    expect(startHostTerminalScrollbackHydration('tab-1', 'repo::/wt', deps)).toBeNull()
    expect(deps.readHostSnapshot).toHaveBeenCalledOnce()
    expect(deps.storeLocalOnly).not.toHaveBeenCalled()
  })

  it('does not write under a pane that mounted while the read was in flight', async () => {
    const { deps } = harness({ isTabMounted: vi.fn(() => true) })
    await startHostTerminalScrollbackHydration('tab-1', 'repo::/wt', deps)
    expect(deps.storeLocalOnly).not.toHaveBeenCalled()
  })

  it('drops bytes for a leaf whose ref changed during the read', async () => {
    const state: { current: HostTerminalScrollbackTabState | null } = { current: null }
    const { deps, tabState } = harness({
      readHostSnapshot: async () => {
        if (state.current) {
          state.current.layout = layout({
            scrollbackRefsByLeafId: { 'leaf-1': `v1-${'d'.repeat(32)}` }
          })
        }
        return 'stale history'
      }
    })
    state.current = tabState
    await startHostTerminalScrollbackHydration('tab-1', 'repo::/wt', deps)
    expect(deps.storeLocalOnly).not.toHaveBeenCalled()
  })

  it('reads from the host on a web client, whose preload has no snapshot store', async () => {
    const webSession = createWebWorkspaceSessionApi().session
    expect(webSession).toBeDefined()
    const { deps, tabState } = harness({
      readLocalSnapshot: (ref) => webSession?.readTerminalScrollback({ ref }) ?? null
    })
    await startHostTerminalScrollbackHydration('tab-1', 'repo::/wt', deps)
    expect(deps.readHostSnapshot).toHaveBeenCalledOnce()
    expect(tabState.localOnly).toEqual({ 'leaf-1': 'host history' })
  })
})
