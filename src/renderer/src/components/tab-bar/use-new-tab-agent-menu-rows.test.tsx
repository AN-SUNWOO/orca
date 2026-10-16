// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { HostCreateSupport } from '@/lib/structured-agent-session-host-admission'
import {
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY as CHAT,
  STRUCTURED_AGENT_SESSION_CLIENT_LAUNCH_MODE_CAPABILITY as CLIENT,
  STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY as CATALOG
} from '../../../../shared/protocol-version'
const mocks = vi.hoisted(() => ({ support: vi.fn() }))
vi.mock('@/lib/structured-agent-session-host-admission', () => ({
  askHostCreateSupport: mocks.support
}))
vi.mock('@/hooks/useDetectedAgents', () => ({
  useDetectedAgents: () => ({ detectedIds: ['claude', 'codex', 'opencode'] })
}))
vi.mock('@/hooks/useAgentDetectionTarget', () => ({
  useAgentDetectionTargetForWorktree: () => ({ kind: 'local' })
}))
vi.mock('@/runtime/local-runtime-capabilities', () => ({
  readLocalRuntimeCapabilitiesOrUnknown: () => null,
  subscribeLocalRuntimeCapabilitiesKnown: () => () => {}
}))
vi.mock('@/runtime/host-structured-agents', () => ({
  readHostStructuredAgents: () =>
    ['claude', 'codex', 'opencode'].map((agent) => ({ agent, capabilities: {} })),
  hostStructuredAgentsVersion: () => 0,
  subscribeHostStructuredAgents: () => () => {}
}))
vi.mock('@/lib/agent-launch-route-input', () => ({
  workspaceKindForWorktreeId: () => 'git-worktree',
  buildAgentLaunchRouteInput: (
    state: ReturnType<typeof useAppStore.getState>,
    { agent }: { agent: string }
  ) => ({
    agent,
    executionHostId: state.activeWorkspaceExecutionHostId ?? 'local',
    hostCapabilities: [CHAT, CLIENT, CATALOG],
    clientCapabilities: [CHAT, CLIENT],
    hostStructuredAgents: ['claude', 'codex', 'opencode']
  })
}))
import { useNewTabAgentMenuRows } from './use-new-tab-agent-menu-rows'
const initial = useAppStore.getState()
const pending: { resolve: (answer: HostCreateSupport) => void; signal: AbortSignal }[] = []
beforeEach(() => {
  vi.useFakeTimers()
  pending.length = 0
  mocks.support
    .mockReset()
    .mockImplementation(
      (_target, _selector, _agent, options) =>
        new Promise<HostCreateSupport>((resolve) =>
          pending.push({ resolve, signal: options.signal })
        )
    )
  useAppStore.setState({
    ...initial,
    settings: { ...initial.settings, experimentalNativeChat: true, disabledTuiAgents: [] },
    localDetectedAgentIdsByContext: { host: ['claude', 'codex'] },
    detectedAgentIds: ['opencode']
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
it.each(['local', 'runtime:server'] as const)(
  'shows host refusals, keeps them across reopen and never blocks a supported chat on %s',
  async (host) => {
    useAppStore.setState({ activeWorkspaceExecutionHostId: host })
    const hook = renderHook(({ open, id }) => useNewTabAgentMenuRows(id, open), {
      initialProps: { open: false, id: 'one' }
    })
    const claude = () => hook.result.current.rows.find((row) => row.agent === 'claude')
    expect(mocks.support).not.toHaveBeenCalled()
    hook.rerender({ open: true, id: 'one' })
    // Before the host answers, a chat this client can see is supported stays clickable.
    expect(claude()).toMatchObject({ kind: 'chat' })
    await act(async () => {
      pending[0]?.resolve({ kind: 'declined', reason: 'wsl' })
      pending[1]?.resolve({ kind: 'declined', reason: 'unsupported-version' })
    })
    expect(
      hook.result.current.rows.map((row) => ('reason' in row ? row.reason : row.kind))
    ).toEqual(expect.arrayContaining(['wsl', 'not-on-host', 'cli']))
    hook.rerender({ open: false, id: 'one' })
    expect(pending[2]?.signal.aborted).toBe(true)
    hook.rerender({ open: true, id: 'one' })
    expect(claude()).toMatchObject({ reason: 'wsl' })
    act(() => useAppStore.setState({ activeTabId: 'unrelated' }))
    hook.rerender({ open: true, id: 'two' })
    expect(pending[3]?.signal.aborted).toBe(true)
    hook.rerender({ open: false, id: 'two' })
    hook.rerender({ open: true, id: 'two' })
    // A reply from the closed menu, or a host past its deadline, never relabels a row.
    await act(async () => pending[6]?.resolve({ kind: 'declined', reason: 'wsl' }))
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(pending[9]?.signal.aborted).toBe(true)
    expect(claude()).toMatchObject({ kind: 'chat' })
    expect(mocks.support).toHaveBeenCalledTimes(12)
  }
)
