import { beforeEach, describe, expect, it, vi } from 'vitest'
import { splitThroughLayoutOwner } from './terminal-pane-split-through-layout-owner'

const mocks = vi.hoisted(
  (): { callRuntimeRpc: ReturnType<typeof vi.fn>; ownerEnvironmentId: string | null } => ({
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
  worktreeId: 'worktree-1',
  tabId: 'tab-1',
  leafId: 'leaf-1',
  direction: 'vertical'
} as const

describe('splitThroughLayoutOwner', () => {
  beforeEach(() => {
    mocks.callRuntimeRpc.mockReset()
    mocks.ownerEnvironmentId = null
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('asks local main for the split and mounts the pane id it minted', async () => {
    mocks.callRuntimeRpc.mockResolvedValue({ ok: true, result: { leafId: 'leaf-minted' } })
    const mount = vi.fn()

    expect(splitThroughLayoutOwner(SPLIT, mount)).toBe(true)

    expect(mocks.callRuntimeRpc).toHaveBeenCalledWith({ kind: 'local' }, 'layout.apply', {
      command: {
        type: 'splitPane',
        workspace: 'worktree-1',
        tabId: 'tab-1',
        leafId: 'leaf-1',
        direction: 'vertical'
      }
    })
    await vi.waitFor(() => expect(mount).toHaveBeenCalledWith('leaf-minted'))
  })

  it.each([
    [
      'a refusal',
      () => mocks.callRuntimeRpc.mockResolvedValue({ ok: false, code: 'pane_not_found' })
    ],
    ['a failed call', () => mocks.callRuntimeRpc.mockRejectedValue(new Error('rpc_failed'))]
  ])('mounts nothing after %s', async (_case, arrange) => {
    arrange()
    const mount = vi.fn()

    expect(splitThroughLayoutOwner(SPLIT, mount)).toBe(true)

    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled())
    expect(mount).not.toHaveBeenCalled()
  })

  it('splits as today when main says a paired server holds the tab', async () => {
    mocks.callRuntimeRpc.mockResolvedValue({ ok: false, code: 'host_not_owned' })
    const mount = vi.fn()

    expect(splitThroughLayoutOwner(SPLIT, mount)).toBe(true)

    await vi.waitFor(() => expect(mount).toHaveBeenCalledWith(undefined))
  })

  it('leaves a paired server’s workspace to today’s split', () => {
    mocks.ownerEnvironmentId = 'env-1'

    expect(splitThroughLayoutOwner(SPLIT, vi.fn())).toBe(false)
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
  })
})
