import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendLayoutCommandToOwner } from './layout-owner-command'

const mocks = vi.hoisted(
  (): {
    callRuntimeRpc: ReturnType<typeof vi.fn>
    ownerEnvironmentId: string | null
  } => ({
    callRuntimeRpc: vi.fn(),
    ownerEnvironmentId: null
  })
)

vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: mocks.callRuntimeRpc }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getExplicitRuntimeEnvironmentIdForWorktree: () => mocks.ownerEnvironmentId
}))

const SPLIT = {
  type: 'splitPane',
  tabId: 'tab-1',
  leafId: 'leaf-1',
  direction: 'vertical'
} as const

function handlers() {
  return { apply: vi.fn(), asToday: vi.fn(), refused: vi.fn() }
}

describe('sendLayoutCommandToOwner', () => {
  beforeEach(() => {
    mocks.callRuntimeRpc.mockReset()
    mocks.ownerEnvironmentId = null
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('asks local main first, then applies main’s result', async () => {
    mocks.callRuntimeRpc.mockResolvedValue({ ok: true, result: { leafId: 'leaf-minted' } })
    const on = handlers()

    expect(sendLayoutCommandToOwner('worktree-1', SPLIT, on)).toBe(true)

    expect(mocks.callRuntimeRpc).toHaveBeenCalledWith({ kind: 'local' }, 'layout.apply', {
      command: { ...SPLIT, workspace: 'worktree-1' }
    })
    expect(on.apply).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(on.apply).toHaveBeenCalledWith({ leafId: 'leaf-minted' }))
    expect(on.asToday).not.toHaveBeenCalled()
  })

  it('changes nothing itself after a refusal', async () => {
    mocks.callRuntimeRpc.mockResolvedValue({ ok: false, code: 'last_pane' })
    const on = handlers()

    expect(sendLayoutCommandToOwner('worktree-1', SPLIT, on)).toBe(true)

    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled())
    expect(on.apply).not.toHaveBeenCalled()
    expect(on.asToday).not.toHaveBeenCalled()
  })

  it.each([
    [
      'main lacks the pane',
      () => mocks.callRuntimeRpc.mockResolvedValue({ ok: false, code: 'pane_not_found' })
    ],
    [
      'main lacks the tab',
      () => mocks.callRuntimeRpc.mockResolvedValue({ ok: false, code: 'tab_not_found' })
    ],
    [
      'main lacks the workspace',
      () => mocks.callRuntimeRpc.mockResolvedValue({ ok: false, code: 'workspace_not_found' })
    ],
    ['the call fails', () => mocks.callRuntimeRpc.mockRejectedValue(new Error('rpc_failed'))]
  ])('acts as today when %s', async (_case, arrange) => {
    arrange()
    const on = handlers()

    sendLayoutCommandToOwner('worktree-1', SPLIT, on)

    await vi.waitFor(() => expect(on.asToday).toHaveBeenCalledOnce())
    expect(on.refused).not.toHaveBeenCalled()
  })

  it('does not run the fallback when the caller’s own handler throws', async () => {
    mocks.callRuntimeRpc.mockResolvedValue({ ok: true, result: { leafId: 'leaf-minted' } })
    const on = handlers()
    on.apply.mockImplementation(() => {
      throw new Error('mount failed')
    })

    sendLayoutCommandToOwner('worktree-1', SPLIT, on)

    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled())
    expect(on.asToday).not.toHaveBeenCalled()
  })

  it('hands any other refusal to the caller', async () => {
    mocks.callRuntimeRpc.mockResolvedValue({ ok: false, code: 'last_pane' })
    const on = handlers()

    sendLayoutCommandToOwner('worktree-1', SPLIT, on)

    await vi.waitFor(() => expect(on.refused).toHaveBeenCalledWith('last_pane'))
  })

  it('acts as today when main says a paired server holds the tab', async () => {
    mocks.callRuntimeRpc.mockResolvedValue({ ok: false, code: 'host_not_owned' })
    const on = handlers()

    expect(sendLayoutCommandToOwner('worktree-1', SPLIT, on)).toBe(true)

    await vi.waitFor(() => expect(on.asToday).toHaveBeenCalled())
    expect(on.apply).not.toHaveBeenCalled()
  })

  it('leaves a paired server’s workspace to today’s path', () => {
    mocks.ownerEnvironmentId = 'env-1'

    expect(sendLayoutCommandToOwner('worktree-1', SPLIT, handlers())).toBe(false)
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
  })
})
