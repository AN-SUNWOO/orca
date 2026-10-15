import { expect, it, vi } from 'vitest'
import { createTestStore } from '@/store/slices/store-test-helpers'
import { createTabsSliceMockApi } from '@/store/slices/tabs-slice-test-harness'
import type { AgentSessionLaunchPlan } from '@/lib/agent-session-launch-plan'

const current = vi.hoisted(() => ({
  store: null as ReturnType<typeof createTestStore> | null,
  launch: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => {
      if (!current.store) {
        throw new Error('No test store')
      }
      return current.store.getState()
    }
  }
}))
vi.mock('@/lib/agent-session-launch-plan', () => ({
  adoptAgentSessionLaunchVerdict: (plan: unknown) => plan
}))
vi.mock('@/lib/structured-agent-session-provisional-tab', () => ({
  beginStructuredAgentSessionProvisionalLaunch: current.launch
}))
createTabsSliceMockApi()

import { runNativeChatSplitTarget } from './native-chat-layout-actions'

it.each(['right', 'down'] as const)(
  'keeps a lone chat and focuses a fresh same-agent chat %s on its owning host',
  async (direction) => {
    const store = createTestStore()
    current.store = store
    const worktreeId = 'folder-workspace'
    const source = store.getState().createUnifiedTab(worktreeId, 'agent-session', {
      entityId: 'original-session',
      agentSessionAgent: 'codex',
      executionHostId: 'runtime:remote-host'
    })
    current.launch.mockImplementation(
      ({ plan, targetGroupId }: { plan: AgentSessionLaunchPlan; targetGroupId: string }) => {
        expect(plan).toMatchObject({
          agent: 'codex',
          worktreeId,
          executionHostId: 'runtime:remote-host'
        })
        expect(plan.prompt).toBeUndefined()
        store.getState().createUnifiedTab(worktreeId, 'agent-session', {
          entityId: 'fresh-session',
          agentSessionAgent: plan.agent,
          executionHostId: plan.executionHostId,
          targetGroupId
        })
        return { settlement: Promise.resolve({ kind: 'structured', sessionId: 'fresh-session' }) }
      }
    )

    expect(
      runNativeChatSplitTarget(
        {
          kind: 'workspace-tab',
          unifiedTabId: source.id,
          groupId: source.groupId
        },
        direction
      )
    ).toBe(true)
    await Promise.resolve()
    const state = store.getState()
    const [original, fresh] = state.unifiedTabsByWorktree[worktreeId] ?? []
    expect(original?.groupId).toBe(source.groupId)
    expect(state.groupsByWorktree[worktreeId]).toHaveLength(2)
    expect(state.activeGroupIdByWorktree[worktreeId]).toBe(fresh?.groupId)
    expect(state.layoutByWorktree[worktreeId]).toMatchObject({
      type: 'split',
      direction: direction === 'right' ? 'horizontal' : 'vertical',
      first: { type: 'leaf', groupId: source.groupId },
      second: { type: 'leaf', groupId: fresh?.groupId }
    })
  }
)
