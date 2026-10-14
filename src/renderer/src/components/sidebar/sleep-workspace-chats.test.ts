import { describe, expect, it } from 'vitest'
import type { Tab } from '../../../../shared/tab-types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { resolveWorkspaceChatSleeps } from './sleep-workspace-chats'

function chat(sessionId: string, executionHostId?: ExecutionHostId): Tab {
  return {
    id: sessionId,
    entityId: sessionId,
    groupId: 'group',
    worktreeId: 'workspace',
    contentType: 'agent-session',
    agentSessionAgent: 'claude',
    label: 'Claude',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 0,
    ...(executionHostId ? { executionHostId } : {})
  }
}

describe('workspace chat Sleep ownership', () => {
  it('stops only chats on the selected host when workspace IDs collide', () => {
    const state = {
      unifiedTabsByWorktree: {
        workspace: [chat('local-chat', 'local'), chat('remote-chat', 'runtime:remote')]
      }
    }

    expect(
      resolveWorkspaceChatSleeps(state, { id: 'workspace', repoId: 'repo', hostId: 'local' })
    ).toEqual([{ sessionId: 'local-chat', target: { kind: 'local' } }])
  })

  it('routes an unstamped saved chat through its known workspace owner', () => {
    const state = {
      unifiedTabsByWorktree: { workspace: [chat('legacy-chat')] },
      worktreesByRepo: {
        repo: [{ id: 'workspace', repoId: 'repo', hostId: 'local' as const }]
      },
      repos: [{ id: 'repo', executionHostId: 'local' as const }]
    }

    expect(
      resolveWorkspaceChatSleeps(state, { id: 'workspace', repoId: 'repo', hostId: 'local' })
    ).toEqual([{ sessionId: 'legacy-chat', target: { kind: 'local' } }])
  })
})
