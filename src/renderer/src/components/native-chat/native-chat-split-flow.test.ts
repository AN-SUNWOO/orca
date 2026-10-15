import { expect, it, vi } from 'vitest'
import { createTestStore } from '@/store/slices/store-test-helpers'
import { createTabsSliceMockApi } from '@/store/slices/tabs-slice-test-harness'

let store: ReturnType<typeof createTestStore>
const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  createSupport: vi.fn(),
  launchCli: vi.fn(),
  error: vi.fn(),
  info: vi.fn()
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => store.getState() } }))
vi.mock('sonner', () => ({ toast: { error: mocks.error, info: mocks.info } }))
vi.mock('@/lib/structured-agent-launch-settlement', () => ({
  beginStructuredAgentLaunchSettlement: mocks.begin
}))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({ launchAgentInNewTab: mocks.launchCli }))
vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.createSupport
}))
createTabsSliceMockApi()

import { runNativeChatSplitTarget } from './native-chat-layout-actions'

it.each(['right', 'down'] as const)(
  'splits %s on the owning host without launching a CLI when it admits or declines',
  async (direction) => {
    vi.clearAllMocks()
    store = createTestStore()
    const worktreeId = 'folder-workspace'
    const executionHostId = 'runtime:remote-host'
    const source = store.getState().createUnifiedTab(worktreeId, 'agent-session', {
      entityId: 'original-session',
      agentSessionAgent: 'codex',
      executionHostId
    })
    mocks.createSupport.mockResolvedValue({ supported: true })
    mocks.begin.mockReturnValue({
      sessionId: 'fresh-session',
      executionHostId,
      settlement: Promise.resolve({ kind: 'structured', sessionId: 'fresh-session' }),
      cancel: vi.fn()
    })

    const target = {
      kind: 'workspace-tab',
      unifiedTabId: source.id,
      groupId: source.groupId
    } as const
    expect(runNativeChatSplitTarget(target, direction)).toBe(true)
    const state = store.getState()
    const groupId = state.activeGroupIdByWorktree[worktreeId]
    expect(state.layoutByWorktree[worktreeId]).toMatchObject({
      type: 'split',
      direction: direction === 'right' ? 'horizontal' : 'vertical',
      first: { type: 'leaf', groupId: source.groupId },
      second: { type: 'leaf', groupId }
    })
    await vi.waitFor(() =>
      expect(store.getState().unifiedTabsByWorktree[worktreeId]).toMatchObject([
        source,
        { entityId: 'fresh-session', agentSessionAgent: 'codex', executionHostId, groupId }
      ])
    )
    expect(store.getState().activeGroupIdByWorktree[worktreeId]).toBe(groupId)
    expect(mocks.begin.mock.lastCall?.[2].executionHostId).toBe(executionHostId)
    expect(mocks.begin.mock.lastCall?.[2].prompt).toBeUndefined()
    const splitTabs = store.getState().unifiedTabsByWorktree[worktreeId]

    mocks.createSupport.mockResolvedValue({ supported: false })
    expect(runNativeChatSplitTarget(target, direction)).toBe(true)
    await vi.waitFor(() => {
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith('Chat could not be started.')
      expect(store.getState().layoutByWorktree[worktreeId]).toEqual(
        state.layoutByWorktree[worktreeId]
      )
    })
    expect(store.getState().unifiedTabsByWorktree[worktreeId]).toEqual(splitTabs)
    expect(mocks.begin).toHaveBeenCalledOnce()
    expect(mocks.launchCli).not.toHaveBeenCalled()
    expect(mocks.info).not.toHaveBeenCalled()
  }
)
