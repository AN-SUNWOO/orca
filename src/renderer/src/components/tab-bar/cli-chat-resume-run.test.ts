// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliChatResumeSource } from './cli-chat-resume-source'
import type { AgentSessionWireRefusal } from '../../../../shared/agent-session-wire'
import type { StructuredAgentSessionCreateParams } from '../../../../shared/structured-agent-session-create'

const mocks = vi.hoisted(() => {
  const state: { source: CliChatResumeSource | null } = { source: null }
  return {
    ...state,
    sourceCapability: vi.fn(),
    createCapability: vi.fn(),
    call: vi.fn(),
    toast: vi.fn(),
    activate: vi.fn(async () => true)
  }
})
vi.mock('./cli-chat-resume-source', () => ({ resolveCliChatResumeSource: () => mocks.source }))
vi.mock('@/runtime/structured-agent-session-client', () => ({
  supportsStructuredAgentSessionCliSource: mocks.sourceCapability,
  supportsStructuredAgentSessionCreateMessage: mocks.createCapability,
  callStructuredAgentSession: mocks.call
}))
vi.mock('@/runtime/structured-session-tab-inventory', () => ({
  readStructuredSessionTabInventory: async () => {
    throw new Error('Reply unavailable')
  }
}))
vi.mock('@/lib/structured-agent-session-create-hydration', () => ({
  publishStructuredAgentSessionCreateHydration: vi.fn()
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toast } }))
vi.mock('@/lib/activate-ai-vault-structured-session', () => ({
  activateAiVaultStructuredSession: mocks.activate
}))

import { useAppStore } from '@/store'
import { runCliChatResume } from './cli-chat-resume-run'
import {
  resetStructuredAgentLaunchRegistryForTests,
  structuredLaunchStates
} from '@/lib/structured-agent-session-launch-registry'
import { isEmptyWorkspaceDefaultSurfacePending } from '@/lib/empty-workspace-default-surface-claims'
import { openStructuredAgentSessionProvisionalTab } from '@/lib/structured-agent-session-provisional-tab'
import {
  clearWebSessionFocusIntent,
  resetWebSessionFocusIntentForTests
} from '@/runtime/web-session-focus-intent'
import { structuredAgentSessionFocusOwner } from '@/runtime/structured-agent-session-owner'

const SOURCE: CliChatResumeSource = {
  tabId: 'tab-1',
  workspaceId: 'wt-1',
  paneKey: 'tab-1:leaf',
  agent: 'claude',
  providerSessionId: 'provider-1',
  executionHostId: 'local'
}
const tabs = () => useAppStore.getState().unifiedTabsByWorktree['wt-1'] ?? []
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function refuse(
  reason: 'transcriptNotFound' | 'transcriptEmpty' | 'transcriptUnreadable'
): AgentSessionWireRefusal {
  return {
    code: 'agent_session_identity_required',
    message: 'private host error',
    details: { reason },
    createAttemptRefusedBeforeCommit: true
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  resetStructuredAgentLaunchRegistryForTests()
  resetWebSessionFocusIntentForTests()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.setState({ activeWorktreeId: 'wt-1' })
  mocks.source = SOURCE
  mocks.sourceCapability.mockResolvedValue(true)
  mocks.createCapability.mockResolvedValue(true)
  mocks.call.mockImplementation(
    async (_target, method, params: StructuredAgentSessionCreateParams) => {
      expect(method).toBe('agentSession.create')
      return { ok: true, value: { sessionId: params.envelope.sessionId, fence: 1 } }
    }
  )
})

describe('CLI identity resume through the existing launch owner', () => {
  it('shares pending, sends only an advertised source, and survives source closure after dispatch', async () => {
    const reply = deferred<unknown>()
    mocks.call.mockReturnValue(reply.promise)
    const running = runCliChatResume(SOURCE)
    await vi.waitFor(() => expect(mocks.call).toHaveBeenCalledOnce())
    await runCliChatResume({ ...SOURCE, paneKey: 'another-pane' })
    expect(mocks.call).toHaveBeenCalledOnce()
    expect(tabs()).toEqual([])
    expect(isEmptyWorkspaceDefaultSurfacePending('wt-1')).toBe(true)
    const params: StructuredAgentSessionCreateParams = mocks.call.mock.calls[0][2]
    expect(params.resumeFrom).toEqual({
      providerSessionId: 'provider-1',
      cliSource: { workspaceId: 'wt-1', paneKey: 'tab-1:leaf' }
    })
    mocks.source = null
    useAppStore.setState({})
    reply.resolve({ ok: true, value: { sessionId: params.envelope.sessionId, fence: 1 } })
    await running
    expect(tabs()).toHaveLength(1)
    expect(isEmptyWorkspaceDefaultSurfacePending('wt-1')).toBe(false)
  })

  it('retires an unsent click during create capability waiting, even if the same source returns', async () => {
    const capability = deferred<boolean>()
    mocks.createCapability.mockReturnValue(capability.promise)
    const running = runCliChatResume(SOURCE)
    await vi.waitFor(() => expect(mocks.createCapability).toHaveBeenCalledOnce())
    mocks.source = null
    useAppStore.setState({})
    await running
    mocks.source = SOURCE
    capability.resolve(true)
    await vi.waitFor(() => expect([...structuredLaunchStates()]).toHaveLength(0))
    expect(mocks.call).not.toHaveBeenCalled()
    expect(tabs()).toEqual([])
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('uses ID-only create for an older host and retains uncertainty without pre-commit proof', async () => {
    mocks.sourceCapability.mockResolvedValue(false)
    mocks.call.mockResolvedValue({
      ok: false,
      refusal: { code: 'agent_session_conflict', message: 'old host' }
    })
    await runCliChatResume(SOURCE, true)
    expect(mocks.call.mock.calls[0][2].resumeFrom).toEqual({ providerSessionId: 'provider-1' })
    expect(tabs()).toHaveLength(1)
    expect(mocks.activate).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('keeps ordinary refusals hidden and distinguishes unsaved from unreadable content', async () => {
    for (const reason of [
      'transcriptNotFound',
      'transcriptEmpty',
      'transcriptUnreadable'
    ] as const) {
      mocks.call.mockResolvedValue({ ok: false, refusal: refuse(reason) })
      await runCliChatResume(SOURCE)
      expect(tabs()).toEqual([])
      expect([...structuredLaunchStates()]).toEqual([])
      expect(mocks.toast.mock.calls.at(-1)?.[0]).toMatch(
        reason === 'transcriptUnreadable' ? /history.*could not/i : /hasn't saved/
      )
    }
  })

  it('opens a proved owner only for the header, on the initiating host, without importing', async () => {
    const owner = { sessionId: 'owner-chat', workspaceId: 'owner-workspace' }
    mocks.call.mockResolvedValue({
      ok: false,
      refusal: {
        code: 'agent_session_conflict',
        message: 'owner',
        details: { reason: 'conversationHeldElsewhere', owner },
        createAttemptRefusedBeforeCommit: true
      }
    })
    await runCliChatResume(SOURCE)
    expect(mocks.toast).toHaveBeenCalledWith('Another chat is already holding this conversation.')
    expect(mocks.activate).not.toHaveBeenCalled()
    await runCliChatResume(SOURCE, true)
    expect(mocks.activate).toHaveBeenCalledWith({ structuredSession: owner }, undefined, {
      kind: 'local'
    })
    expect(tabs()).toEqual([])
  })

  it('does not re-activate a published destination over a later selection', async () => {
    const reply = deferred<unknown>()
    mocks.call.mockReturnValue(reply.promise)
    const running = runCliChatResume(SOURCE)
    await vi.waitFor(() => expect(mocks.call).toHaveBeenCalledOnce())
    const sessionId: string = mocks.call.mock.calls[0][2].envelope.sessionId
    openStructuredAgentSessionProvisionalTab({
      worktreeId: 'wt-1',
      executionHostId: 'local',
      sessionId,
      agent: 'claude'
    })
    clearWebSessionFocusIntent(structuredAgentSessionFocusOwner({ kind: 'local' }), 'wt-1')
    const later = useAppStore
      .getState()
      .createUnifiedTab('wt-1', 'editor', { entityId: 'later-file', label: 'Later' })
    reply.resolve({ ok: true, value: { sessionId, fence: 1 } })
    await running
    const state = useAppStore.getState()
    expect(tabs().filter((tab) => tab.entityId === sessionId)).toHaveLength(1)
    expect(
      state.groupsByWorktree['wt-1'].find((group) => group.id === later.groupId)?.activeTabId
    ).toBe(later.id)
  })
})
