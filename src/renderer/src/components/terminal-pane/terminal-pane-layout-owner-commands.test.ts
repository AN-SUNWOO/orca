import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { equalizeTerminalPanes } from './terminal-pane-layout-owner-commands'

const mocks = vi.hoisted(
  (): {
    callRuntimeRpc: ReturnType<typeof vi.fn>
    ownerEnvironmentId: string | null
    layoutOwnerIsMain: boolean
  } => ({
    callRuntimeRpc: vi.fn(),
    ownerEnvironmentId: null,
    layoutOwnerIsMain: false
  })
)

vi.mock('../../../../shared/layout-owner-switch', () => ({
  get ORCA_LAYOUT_OWNER_IS_MAIN() {
    return mocks.layoutOwnerIsMain
  }
}))

vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: mocks.callRuntimeRpc }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getExplicitRuntimeEnvironmentIdForWorktree: () => mocks.ownerEnvironmentId
}))

describe('equalizeTerminalPanes', () => {
  beforeEach(() => {
    mocks.callRuntimeRpc.mockReset()
    mocks.ownerEnvironmentId = null
    mocks.layoutOwnerIsMain = false
  })

  function manager() {
    const equalizePaneSizes = vi.fn()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: equalize calls only equalizePaneSizes.
    return { equalizePaneSizes } as unknown as PaneManager & {
      equalizePaneSizes: typeof equalizePaneSizes
    }
  }

  it('a window-owned build equalizes at once, without asking main', () => {
    const current = manager()
    const then = vi.fn()

    equalizeTerminalPanes(
      { worktreeId: 'worktree-1', tabId: 'tab-1', getManager: () => current },
      then
    )

    expect(current.equalizePaneSizes).toHaveBeenCalledOnce()
    expect(then).toHaveBeenCalledWith(current)
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
  })

  it('a layout-owner build equalizes once main has', async () => {
    mocks.layoutOwnerIsMain = true
    mocks.callRuntimeRpc.mockResolvedValue({ ok: true, result: {} })
    const current = manager()

    equalizeTerminalPanes(
      { worktreeId: 'worktree-1', tabId: 'tab-1', getManager: () => current },
      vi.fn()
    )

    expect(mocks.callRuntimeRpc).toHaveBeenCalledWith({ kind: 'local' }, 'layout.apply', {
      command: { type: 'equalizePanes', tabId: 'tab-1', workspace: 'worktree-1' }
    })
    expect(current.equalizePaneSizes).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(current.equalizePaneSizes).toHaveBeenCalledOnce())
  })
})
