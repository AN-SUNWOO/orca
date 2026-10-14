import { beforeEach, describe, expect, it, vi } from 'vitest'

type SleepTestState = {
  activeWorktreeId: string | null
  activeWorkspaceExecutionHostId: string | null
  folderWorkspaces: {
    id: string
    projectGroupId: string
    connectionId: null
    executionHostId: null
  }[]
  projectGroups: { id: string; connectionId: null; executionHostId: string }[]
  setActiveWorktree: ReturnType<typeof vi.fn>
  shutdownWorktreeBrowsers: ReturnType<typeof vi.fn>
  shutdownWorktreeTerminals: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => {
  const state: SleepTestState = {
    activeWorktreeId: null,
    activeWorkspaceExecutionHostId: null,
    folderWorkspaces: [],
    projectGroups: [],
    setActiveWorktree: vi.fn((id: string | null) => {
      state.activeWorktreeId = id
      if (id === null) {
        state.activeWorkspaceExecutionHostId = null
      }
    }),
    shutdownWorktreeBrowsers: vi.fn().mockResolvedValue(undefined),
    shutdownWorktreeTerminals: vi.fn().mockResolvedValue(undefined)
  }
  return {
    state,
    call: vi.fn().mockResolvedValue({ stoppedSessionIds: ['session-1'] }),
    target: vi.fn(() => ({ kind: 'local' })),
    suspend: vi.fn().mockResolvedValue(null),
    toast: vi.fn()
  }
})

vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('sonner', () => ({ toast: { error: mocks.toast } }))
vi.mock('@/runtime/structured-agent-session-owner', () => ({
  structuredAgentSessionTargetForHost: mocks.target
}))
vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call
}))

import { runSleepWorktree, runSleepWorktrees } from './sleep-worktree-flow'
import {
  clearWorktreeSleepIntent,
  forgetWorktreeSleepIntent,
  hasWorktreeSleepIntent
} from '@/lib/worktree-sleep-intent'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('workspace sleep flow', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      api: { ephemeralVm: { suspendWorkspace: mocks.suspend } }
    })
    for (const id of ['wt-1', 'wt-2', 'folder:folder-1']) {
      forgetWorktreeSleepIntent(id)
    }
    mocks.state.activeWorktreeId = null
    mocks.state.activeWorkspaceExecutionHostId = null
    mocks.state.folderWorkspaces = []
    mocks.state.projectGroups = []
    mocks.state.setActiveWorktree.mockClear()
    mocks.state.shutdownWorktreeBrowsers.mockClear().mockResolvedValue(undefined)
    mocks.state.shutdownWorktreeTerminals.mockClear().mockResolvedValue(undefined)
    mocks.call.mockClear().mockResolvedValue({ stoppedSessionIds: ['session-1'] })
    mocks.target.mockClear()
    mocks.suspend.mockClear().mockResolvedValue(null)
    mocks.toast.mockClear()
  })

  it('issues native stop before panels and keeps the chat tab identity outside teardown', async () => {
    const native = deferred<{ stoppedSessionIds: string[] }>()
    mocks.call.mockReturnValueOnce(native.promise)
    const sleep = runSleepWorktree('wt-1', 'local')
    expect(mocks.call).toHaveBeenCalledWith({ kind: 'local' }, 'agentSession.sleepWorkspace', {
      workspaceId: 'wt-1'
    })
    expect(mocks.state.shutdownWorktreeBrowsers).not.toHaveBeenCalled()
    native.resolve({ stoppedSessionIds: ['session-1'] })
    await expect(sleep).resolves.toEqual([
      {
        workspaceId: 'wt-1',
        executionHostId: 'local',
        stoppedSessionIds: ['session-1'],
        completed: true
      }
    ])
    expect(mocks.state.shutdownWorktreeBrowsers).toHaveBeenCalledBefore(
      mocks.state.shutdownWorktreeTerminals
    )
    expect(mocks.suspend).toHaveBeenCalledWith({
      workspaceId: 'wt-1',
      executionHostId: 'local'
    })
  })

  it('keeps successfully stopped terminals asleep on a native RPC failure', async () => {
    mocks.call.mockRejectedValueOnce(new Error('method_not_found'))
    const result = await runSleepWorktree('wt-1', 'local')
    expect(result[0]).toMatchObject({ completed: false, stoppedSessionIds: [] })
    expect(mocks.state.shutdownWorktreeTerminals).toHaveBeenCalled()
    expect(mocks.suspend).toHaveBeenCalled()
    expect(hasWorktreeSleepIntent('wt-1', 'local')).toBe(true)
    expect(mocks.toast).toHaveBeenCalledTimes(1)
  })

  it('does not run delayed panels or steal a newer selection after an explicit wake', async () => {
    mocks.state.activeWorktreeId = 'wt-1'
    mocks.state.activeWorkspaceExecutionHostId = 'local'
    const native = deferred<{ stoppedSessionIds: string[] }>()
    mocks.call.mockReturnValueOnce(native.promise)
    const sleep = runSleepWorktree('wt-1', 'local')
    expect(mocks.state.setActiveWorktree).toHaveBeenCalledWith(null)
    clearWorktreeSleepIntent('wt-1', 'local')
    mocks.state.activeWorktreeId = 'wt-2'
    native.resolve({ stoppedSessionIds: ['session-1'] })
    expect((await sleep)[0].completed).toBe(false)
    expect(mocks.state.shutdownWorktreeBrowsers).not.toHaveBeenCalled()
    expect(mocks.state.activeWorktreeId).toBe('wt-2')
  })

  it('issues every host call before a slow sibling permits panel teardown', async () => {
    const first = deferred<{ stoppedSessionIds: string[] }>()
    const second = deferred<{ stoppedSessionIds: string[] }>()
    mocks.call.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const sleep = runSleepWorktrees([
      { id: 'wt-1', executionHostId: 'local' },
      { id: 'wt-2', executionHostId: 'local' }
    ])
    expect(mocks.call).toHaveBeenCalledTimes(2)
    expect(mocks.state.shutdownWorktreeBrowsers).not.toHaveBeenCalled()
    first.resolve({ stoppedSessionIds: ['one'] })
    second.resolve({ stoppedSessionIds: ['two'] })
    expect((await sleep).map((result) => result.stoppedSessionIds)).toEqual([['one'], ['two']])
  })

  it('routes an inherited folder lane to the host rendered for its project group', async () => {
    mocks.state.folderWorkspaces = [
      {
        id: 'folder-1',
        projectGroupId: 'group-1',
        connectionId: null,
        executionHostId: null
      }
    ]
    mocks.state.projectGroups = [
      {
        id: 'group-1',
        connectionId: null,
        executionHostId: 'runtime:env-1'
      }
    ]
    const result = await runSleepWorktrees([{ id: 'folder:folder-1', hostId: 'local' }])
    expect(result[0].executionHostId).toBe('runtime:env-1')
    expect(mocks.target).toHaveBeenCalledWith('runtime:env-1')
  })
})
