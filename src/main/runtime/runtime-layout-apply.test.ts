import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyWindowLayoutCommand, type WindowLayoutCommand } from './runtime-layout-apply'
import type { RuntimeStore } from './runtime-store-contract'
import type { LayoutApplyOutcome } from '../../shared/workspace-layout/workspace-layout-command-types'

const mocks = vi.hoisted(() => ({ markAgentLaunchesClosedByUser: vi.fn() }))
vi.mock('../agent-launch/agent-launch-pane-attachment', () => ({
  markAgentLaunchesClosedByUser: mocks.markAgentLaunchesClosedByUser
}))

const CLOSE = { type: 'closePane', workspace: 'wt-1', tabId: 'tab-1', leafId: 'leaf-1' } as const

function storeWith() {
  const applyLayoutCommand = vi.fn(async (): Promise<LayoutApplyOutcome> => ({
    ok: true,
    result: {}
  }))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the apply path reads only applyLayoutCommand.
  const store = { applyLayoutCommand } as unknown as RuntimeStore
  return { store, applyLayoutCommand }
}

describe('applyWindowLayoutCommand', () => {
  beforeEach(() => mocks.markAgentLaunchesClosedByUser.mockReset())

  it('closes a pane as the user’s close, in every local or SSH holder', async () => {
    const { store, applyLayoutCommand } = storeWith()

    await applyWindowLayoutCommand(store, () => ['local', 'runtime:env-1', 'ssh:target-1'], CLOSE)

    expect(applyLayoutCommand).toHaveBeenCalledWith({ ...CLOSE, userPaneClose: true }, [
      'local',
      'ssh:target-1'
    ])
    expect(mocks.markAgentLaunchesClosedByUser).toHaveBeenCalledWith('wt-1', {
      kind: 'pane',
      tabId: 'tab-1',
      leafId: 'leaf-1'
    })
  })

  it('applies other commands to the routed partition only', async () => {
    const { store, applyLayoutCommand } = storeWith()
    const rename = { ...CLOSE, type: 'renamePane', title: 'Pane' } as const

    await applyWindowLayoutCommand(store, () => ['local', 'ssh:target-1'], rename)

    expect(applyLayoutCommand).toHaveBeenCalledWith(rename, ['local'])
    expect(mocks.markAgentLaunchesClosedByUser).not.toHaveBeenCalled()
  })

  it('routes a group tree command by its workspace, with no tab to look up', async () => {
    const { store, applyLayoutCommand } = storeWith()
    const hostIdsFor = vi.fn(() => ['ssh:target-1' as const])
    const ratios = {
      type: 'setGroupRatios',
      workspace: 'wt-1',
      groupLayout: { type: 'leaf', groupId: 'g1' }
    } as const

    await applyWindowLayoutCommand(store, hostIdsFor, ratios)

    expect(hostIdsFor).toHaveBeenCalledWith('wt-1', null)
    expect(applyLayoutCommand).toHaveBeenCalledWith(ratios, ['ssh:target-1'])
  })

  it('records the window’s tab close in every holder, forced, stopping no terminal', async () => {
    const { store, applyLayoutCommand } = storeWith()
    const close: WindowLayoutCommand = {
      type: 'closeTabs',
      workspace: 'wt-1',
      tabIds: ['tab-1'],
      recordClose: 'user'
    }

    await applyWindowLayoutCommand(store, () => ['local', 'runtime:env-1', 'ssh:target-1'], close)

    expect(applyLayoutCommand).toHaveBeenCalledWith({ ...close, force: true }, [
      'local',
      'ssh:target-1'
    ])
    expect(mocks.markAgentLaunchesClosedByUser).toHaveBeenCalledWith('wt-1', {
      kind: 'tab',
      tabId: 'tab-1'
    })
  })

  it('marks a user close’s launches by the terminal’s id, not its tab-bar entry’s', async () => {
    const { store } = storeWith()
    const session = { unifiedTabs: { 'wt-1': [{ id: 'entry-1', entityId: 'term-1' }] } }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the close reads only unifiedTabs.
    const withSession = { ...store, getWorkspaceSession: () => session } as unknown as RuntimeStore
    const close: WindowLayoutCommand = {
      type: 'closeTabs',
      workspace: 'wt-1',
      tabIds: ['entry-1'],
      recordClose: 'user'
    }

    await applyWindowLayoutCommand(withSession, () => ['local'], close)

    expect(mocks.markAgentLaunchesClosedByUser).toHaveBeenCalledWith('wt-1', {
      kind: 'tab',
      tabId: 'term-1'
    })
  })

  it('leaves a cleanup close’s launches alone, and a workspace main lacks to today’s close', async () => {
    const { store, applyLayoutCommand } = storeWith()
    applyLayoutCommand.mockResolvedValueOnce({ ok: true, result: { alreadyClosed: true } })
    const close: WindowLayoutCommand = {
      type: 'closeTabs',
      workspace: 'wt-1',
      tabIds: ['tab-1'],
      recordClose: 'cleanup'
    }

    await expect(applyWindowLayoutCommand(store, () => ['local'], close)).resolves.toEqual({
      ok: false,
      code: 'workspace_not_found'
    })
    expect(mocks.markAgentLaunchesClosedByUser).not.toHaveBeenCalled()
  })

  it('refuses a tab a paired server routes, touching nothing', async () => {
    const { store, applyLayoutCommand } = storeWith()

    await expect(
      applyWindowLayoutCommand(store, () => ['runtime:env-1', 'local'], CLOSE)
    ).resolves.toEqual({ ok: false, code: 'host_not_owned' })
    expect(applyLayoutCommand).not.toHaveBeenCalled()
    expect(mocks.markAgentLaunchesClosedByUser).not.toHaveBeenCalled()
  })
})
