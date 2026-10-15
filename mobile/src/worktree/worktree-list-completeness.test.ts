import { describe, expect, it } from 'vitest'
import { NO_PROJECT_SECTION_CATALOG, buildSections, type Worktree } from './workspace-list-sections'
import {
  applyDesktopViewSettings,
  type MobileViewState,
  type WorkspaceViewSettings
} from './workspace-view-settings'
import { DEFAULT_MOBILE_WORKSPACE_STATUSES } from './mobile-workspace-statuses'

// Regression guard for "host page shows lots of worktrees, repo shows only a
// few". The removed getHostScopedWorktrees filtered the list to worktrees whose
// repoId appeared in the repo.list result — a map keyed by repo DISPLAY NAME.
// Same-named repos on different hosts (a local "orca" and a runtime "orca")
// collapsed to one id, so every worktree under the other id vanished. These
// tests assert the user-visible outcome — every worktree from worktree.ps stays
// in the list — regardless of repo.list contents or desktop host scope, so they
// hold even if the plumbing is refactored, as long as workspaces stop vanishing.

function worktree(repoId: string, id: string, repo = repoId): Worktree {
  return {
    workspaceKind: 'git',
    worktreeId: id,
    repoId,
    repo,
    branch: `feature/${id}`,
    displayName: id,
    path: `/tmp/orca/${repoId}/${id}`,
    liveTerminalCount: 0,
    hasAttachedPty: false,
    preview: '',
    unread: false,
    isPinned: false,
    linkedPR: null,
    status: 'inactive',
    agents: []
  }
}

const base: MobileViewState = {
  groupMode: 'repo',
  sortMode: 'recent',
  hideSleeping: false,
  hideDefaultBranch: false,
  filterRepoIds: [],
  collapsedGroups: [],
  workspaceStatuses: DEFAULT_MOBILE_WORKSPACE_STATUSES
}

// Reconstruct the list the host screen renders: apply the synced desktop
// settings, then build sections exactly as the screen does. `catalogRepos` are
// [displayName, id] rows of the repo.list catalog the screen groups by.
function visibleWorktreeIds(
  worktrees: Worktree[],
  catalogRepos: readonly (readonly [string, string])[],
  desktop: WorkspaceViewSettings = {}
): string[] {
  const state = applyDesktopViewSettings(base, desktop)
  const sections = buildSections(
    worktrees,
    state.sortMode,
    {
      filterRepoIds: new Set(state.filterRepoIds),
      hideSleeping: state.hideSleeping,
      hideDefaultBranch: state.hideDefaultBranch
    },
    '',
    state.groupMode,
    new Set(),
    {
      ...NO_PROJECT_SECTION_CATALOG,
      repos: catalogRepos.map(([displayName, id]) => ({ id, displayName, path: `/repos/${id}` }))
    },
    state.workspaceStatuses,
    new Set(state.collapsedGroups)
  )
  return sections.flatMap((section) => section.data.map((w) => w.worktreeId)).sort()
}

describe('every worktree stays visible regardless of repo.list contents', () => {
  it('shows worktrees whose repoId is missing from repo.list', () => {
    // repo.list only echoes one of the repos the worktrees belong to.
    const worktrees = [
      worktree('orca-local', 'a'),
      worktree('orca-local', 'b'),
      worktree('orca-runtime', 'c')
    ]
    const catalogRepos = [['orca-runtime', 'orca-runtime']] as const

    expect(visibleWorktreeIds(worktrees, catalogRepos)).toEqual(['a', 'b', 'c'])
  })

  it('shows every worktree when the same repo name maps to two host-specific ids', () => {
    // The exact trigger: a local "orca" and a runtime "orca". repo.list returns
    // both under the same displayName; a name-keyed map keeps only the last id.
    const worktrees = [
      worktree('orca-local', 'local-1', 'orca'),
      worktree('orca-local', 'local-2', 'orca'),
      worktree('orca-runtime', 'runtime-1', 'orca')
    ]
    // The catalog names only one of the two "orca" repos.
    const catalogRepos = [['orca', 'orca-runtime']] as const

    expect(visibleWorktreeIds(worktrees, catalogRepos)).toEqual(['local-1', 'local-2', 'runtime-1'])
  })

  it('shows every worktree even when the desktop carries a host scope', () => {
    // Host scope must never reach the mobile list either (it has no mobile UI).
    const worktrees = [worktree('local-repo', 'x'), worktree('runtime-repo', 'y')]
    const catalogRepos = [
      ['local-repo', 'local-repo'],
      ['runtime-repo', 'runtime-repo']
    ] as const

    // A variable, not a literal: `workspaceHostScope` is not a member the phone reads.
    const desktopWithHostScope = {
      workspaceHostScope: 'runtime:devbox',
      visibleWorkspaceHostIds: ['runtime:devbox']
    }

    expect(visibleWorktreeIds(worktrees, catalogRepos, desktopWithHostScope)).toEqual(['x', 'y'])
  })
})
