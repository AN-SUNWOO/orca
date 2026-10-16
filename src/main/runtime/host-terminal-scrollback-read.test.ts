import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import type { TerminalTab } from '../../shared/terminal-tab-types'
import { TERMINAL_SCROLLBACK_STORE_BYTE_LIMIT } from '../../shared/terminal-scrollback-limits'
import {
  readHostTerminalScrollback,
  type HostTerminalScrollbackReadDeps
} from './host-terminal-scrollback-read'

const HELD_REF = `v1-${'a'.repeat(32)}`
const OTHER_WORKTREE_REF = `v1-${'b'.repeat(32)}`

function tab(id: string, worktreeId: string): TerminalTab {
  return {
    id,
    ptyId: null,
    worktreeId,
    title: 'Terminal',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function session(): WorkspaceSessionState {
  return {
    activeRepoId: null,
    activeWorktreeId: null,
    activeTabId: null,
    tabsByWorktree: {
      'repo::/wt-a': [tab('tab-a', 'repo::/wt-a')],
      'repo::/wt-b': [tab('tab-b', 'repo::/wt-b')]
    },
    terminalLayoutsByTabId: {
      'tab-a': {
        root: { type: 'leaf', leafId: 'leaf-a' },
        activeLeafId: 'leaf-a',
        expandedLeafId: null,
        scrollbackRefsByLeafId: { 'leaf-a': HELD_REF }
      },
      'tab-b': {
        root: { type: 'leaf', leafId: 'leaf-b' },
        activeLeafId: 'leaf-b',
        expandedLeafId: null,
        scrollbackRefsByLeafId: { 'leaf-b': OTHER_WORKTREE_REF }
      }
    }
  }
}

function deps(overrides: Partial<HostTerminalScrollbackReadDeps> = {}) {
  const readSnapshot = vi.fn((ref: string) => (ref === HELD_REF ? 'stored history' : null))
  const resolved: HostTerminalScrollbackReadDeps = {
    resolveWorktreeId: async (selector) => {
      if (!selector.startsWith('id:')) {
        throw new Error('selector_not_found')
      }
      return selector.slice(3)
    },
    getWorkspaceSession: () => session(),
    readSnapshot,
    ...overrides
  }
  return { resolved, readSnapshot }
}

describe('readHostTerminalScrollback', () => {
  it('returns the stored bytes for a ref a tab of the caller worktree names', async () => {
    const { resolved } = deps()
    await expect(
      readHostTerminalScrollback(resolved, { worktree: 'id:repo::/wt-a', ref: HELD_REF })
    ).resolves.toEqual({ buffer: 'stored history' })
  })

  it('refuses a ref named only by another worktree without touching the store', async () => {
    const { resolved, readSnapshot } = deps()
    await expect(
      readHostTerminalScrollback(resolved, { worktree: 'id:repo::/wt-a', ref: OTHER_WORKTREE_REF })
    ).rejects.toThrow('terminal_scrollback_not_found')
    expect(readSnapshot).not.toHaveBeenCalled()
  })

  it('refuses a worktree the host cannot resolve', async () => {
    const { resolved, readSnapshot } = deps()
    await expect(
      readHostTerminalScrollback(resolved, { worktree: 'path:/elsewhere', ref: HELD_REF })
    ).rejects.toThrow('selector_not_found')
    expect(readSnapshot).not.toHaveBeenCalled()
  })

  it('answers not-found when the named snapshot file is missing', async () => {
    const { resolved } = deps({ readSnapshot: () => null })
    await expect(
      readHostTerminalScrollback(resolved, { worktree: 'id:repo::/wt-a', ref: HELD_REF })
    ).rejects.toThrow('terminal_scrollback_not_found')
  })

  it('answers not-found when the host has no session for the worktree', async () => {
    const { resolved } = deps({ getWorkspaceSession: () => null })
    await expect(
      readHostTerminalScrollback(resolved, { worktree: 'id:repo::/wt-a', ref: HELD_REF })
    ).rejects.toThrow('terminal_scrollback_not_found')
  })

  it('refuses bytes over the scrollback store limit', async () => {
    const oversized = 'x'.repeat(TERMINAL_SCROLLBACK_STORE_BYTE_LIMIT + 1)
    const { resolved } = deps({ readSnapshot: () => oversized })
    await expect(
      readHostTerminalScrollback(resolved, { worktree: 'id:repo::/wt-a', ref: HELD_REF })
    ).rejects.toThrow('terminal_scrollback_too_large')
  })
})
