import { expect, it, vi } from 'vitest'
import { createTestStore } from '@/store/slices/store-test-helpers'
import { createTabsSliceMockApi } from '@/store/slices/tabs-slice-test-harness'

let store: ReturnType<typeof createTestStore>
const launch = vi.hoisted(() => vi.fn())
vi.mock('@/store', () => ({ useAppStore: { getState: () => store.getState() } }))
vi.mock('@/lib/agent-session-launch-plan', () => ({
  adoptAgentSessionLaunchVerdict: (plan: unknown) => plan
}))
vi.mock('@/lib/structured-agent-session-provisional-tab', () => ({
  beginStructuredAgentSessionProvisionalLaunch: launch
}))
createTabsSliceMockApi()

import { runNativeChatSplitTarget } from './native-chat-layout-actions'

it.each(['right', 'down'] as const)(
  'keeps a lone chat and focuses a fresh same-agent chat %s on its owning host',
  (direction) => {
    store = createTestStore()
    const worktreeId = 'folder-workspace'
    const source = store.getState().createUnifiedTab(worktreeId, 'agent-session', {
      entityId: 'original-session',
      agentSessionAgent: 'codex',
      executionHostId: 'runtime:remote-host'
    })
    launch.mockReturnValue({ settlement: new Promise(() => {}) })

    const target = {
      kind: 'workspace-tab',
      unifiedTabId: source.id,
      groupId: source.groupId
    } as const
    expect(runNativeChatSplitTarget(target, direction)).toBe(true)
    const state = store.getState()
    const groupId = state.activeGroupIdByWorktree[worktreeId]
    expect(state.unifiedTabsByWorktree[worktreeId]).toEqual([source])
    expect(launch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        targetGroupId: groupId,
        plan: expect.objectContaining({
          agent: 'codex',
          worktreeId,
          executionHostId: source.executionHostId
        })
      })
    )
    expect(launch.mock.lastCall?.[0].plan.prompt).toBeUndefined()
    expect(state.layoutByWorktree[worktreeId]).toMatchObject({
      type: 'split',
      direction: direction === 'right' ? 'horizontal' : 'vertical',
      first: { type: 'leaf', groupId: source.groupId },
      second: { type: 'leaf', groupId }
    })
  }
)
