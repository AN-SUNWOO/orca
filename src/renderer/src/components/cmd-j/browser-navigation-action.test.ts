import { describe, expect, it, vi } from 'vitest'
import { buildCmdJBrowserNavigationAction } from './browser-navigation-action'
import type { CmdJQuickActionContext } from './quick-action-context'

function context(overrides: Partial<CmdJQuickActionContext> = {}): CmdJQuickActionContext {
  return {
    activeView: 'terminal',
    activeWorktreeId: 'folder:research',
    activeWorktree: null,
    isLoading: false,
    sshStatus: null,
    runtimeMode: 'local-desktop',
    activeGroupId: 'research-group',
    openNewBrowserTab: vi.fn().mockResolvedValue(undefined),
    openNewMarkdownFile: vi.fn(),
    openNewTerminalTab: vi.fn(),
    openCreateWorkspace: vi.fn(),
    deleteActiveWorkspace: vi.fn(),
    openAddQuickCommand: vi.fn(),
    ...overrides
  }
}

describe('Cmd+J website navigation', () => {
  it.each([
    ['brex.com', 'https://brex.com/'],
    ['  brex.com  ', 'https://brex.com/'],
    ['brex.com/signup?source=orca#start', 'https://brex.com/signup?source=orca#start'],
    ['https://brex.com/login', 'https://brex.com/login'],
    ['localhost:3000', 'http://localhost:3000/'],
    ['127.0.0.1:5173/docs', 'http://127.0.0.1:5173/docs'],
    ['[::1]:8080', 'http://[::1]:8080/']
  ])('opens %s in the invoking group with its normalized URL', async (query, url) => {
    const action = buildCmdJBrowserNavigationAction(query)
    const ctx = context()
    expect(action?.title).toBe(`Go to ${query.trim()}`)
    expect(await action?.run(ctx)).toEqual({ status: 'ok' })
    expect(ctx.openNewBrowserTab).toHaveBeenCalledExactlyOnceWith('research-group', url)
  })

  it.each([
    '',
    'brex',
    'brex login',
    'src/app.ts',
    'README.md',
    '/tmp/brex.com',
    'javascript:alert(1)',
    'file:///tmp/index.html',
    'https://',
    'localhost:99999',
    `${'a'.repeat(2050)}.com`
  ])('keeps %s in the normal search flow', (query) => {
    expect(buildCmdJBrowserNavigationAction(query)).toBeNull()
  })

  it.each([
    [{ activeWorktreeId: null }, 'no-active-workspace'],
    [{ activeGroupId: null }, 'no-active-group'],
    [{ isLoading: true }, 'loading'],
    [{ sshStatus: 'disconnected' as const }, 'ssh-disconnected'],
    [{ managedBrowserCreationEnabled: false }, 'client-action-unsupported']
  ])('rechecks browser availability before creating a tab (%s)', async (overrides, reason) => {
    const action = buildCmdJBrowserNavigationAction('brex.com')
    const ctx = context(overrides)
    expect(await action?.run(ctx)).toEqual({ status: 'unavailable', reason })
    expect(ctx.openNewBrowserTab).not.toHaveBeenCalled()
  })
})
