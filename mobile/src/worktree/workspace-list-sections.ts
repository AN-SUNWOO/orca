import type { WorkspaceStatusDefinition } from '../../../src/shared/worktree/types'
import {
  DEFAULT_WORKSPACE_STATUSES,
  getWorkspaceStatus,
  getWorkspaceStatusGroupKey,
  withDefaultWorkspaceStatuses
} from '../../../src/shared/workspace-statuses'
import {
  applyMobileWorkspaceLineage,
  getMobileWorkspaceLineageChildren
} from './mobile-workspace-lineage'
import {
  getPRGroupKeyForState,
  getPRLaneKey,
  PR_GROUP_LABELS,
  PR_GROUP_ORDER
} from '../../../src/shared/workspace-view/workspace-pr-groups'
import type { FilterState, Section, SectionRepo, Worktree } from './workspace-list-types'
import type {
  WorkspaceGroupBy,
  WorkspaceSortBy
} from '../../../src/shared/workspace-view/workspace-view-options'
import { sortWorktrees } from './workspace-list-ordering'
import { getWorktreeRowIdentity } from './worktree-host-row-identity'
import { resolveWorktreeHostId } from './worktree-host-context-labels'
import type { ExecutionHostId } from '../../../src/shared/execution-host'
import {
  buildProjectGroupingIndex,
  buildProjectSections,
  type ProjectSectionModel
} from '../../../src/shared/project-section-grouping'
import { withRepoSectionDisplayLabels } from '../../../src/shared/project-section-order'
import type { ProjectOrderBy } from '../../../src/shared/ui-chrome-types'
import {
  filterWorkspaceRows,
  type WorkspaceRowFactReader
} from '../../../src/shared/workspace-view/workspace-row-filters'

export type { FilterState, Section, SectionRepo, Worktree } from './workspace-list-types'

/** What Project grouping reads beyond the rows: the desktop's all-host catalog and header order. */
export type ProjectSectionCatalog = {
  /** Catalog repos of the hosts the list shows; each without rows gets an empty section. */
  repos: readonly SectionRepo[]
  /** Null until the desktop's catalog answers; rows then group by repo, as the desktop's would. */
  grouping: ProjectSectionModel | null
  /** Manual header rank; undefined keeps first-row order. */
  repoOrder: ReadonlyMap<string, number> | undefined
  projectOrderBy: ProjectOrderBy
}

export const NO_PROJECT_SECTION_CATALOG: ProjectSectionCatalog = {
  repos: [],
  grouping: null,
  repoOrder: undefined,
  projectOrderBy: 'manual'
}

/** Catalog repos by id, plus a stand-in from the row for a repo its host's catalog lacks. */
export function buildSectionRepoMap(
  catalogRepos: readonly SectionRepo[],
  worktrees: readonly Worktree[]
): Map<string, SectionRepo> {
  const repoMap = new Map(catalogRepos.map((repo) => [repo.id, repo]))
  for (const w of worktrees) {
    if (!repoMap.has(w.repoId)) {
      repoMap.set(w.repoId, {
        id: w.repoId,
        displayName: w.repo || 'Unknown',
        // Why: labels key on host + path, so a shared '' would let one stand-in rename another.
        path: w.repoId,
        executionHostId: w.hostId
      })
    }
  }
  return repoMap
}
export { getWorktreeStatus, sortWorktrees } from './workspace-list-ordering'

function makeSection(
  key: string,
  title: string,
  data: Worktree[],
  collapsedGroups: ReadonlySet<string>,
  decoration: { icon?: 'pin'; repo?: SectionRepo } = {}
): Section {
  const rows = applyMobileWorkspaceLineage(data, collapsedGroups)
  return {
    key,
    title,
    ...(decoration.icon ? { icon: decoration.icon } : {}),
    ...(decoration.repo ? { repo: decoration.repo } : {}),
    data: rows.map((worktree) => ({
      ...worktree,
      sectionListKey: `${key}:${getWorktreeRowIdentity(worktree)}`
    }))
  }
}

// Why: the previous 10-minute lastOutputAt window was too strict — most
// worktrees with idle terminal prompts had no recent output and were excluded.
// Any worktree with live terminals or unread output counts as "active".
export function isWorktreeActive(w: Worktree): boolean {
  if (w.hasHostSidebarActivity !== undefined) {
    return w.hasHostSidebarActivity
  }
  if (w.unread) {
    return true
  }
  if (w.status) {
    return w.status !== 'inactive'
  }
  if (w.liveTerminalCount > 0) {
    return true
  }
  return false
}

/** An older host's row says nothing about its default branch; guess the way the phone always has. */
function guessDefaultBranchWorkspace(w: Worktree): boolean {
  if (w.isMainWorktree !== undefined) {
    return w.isMainWorktree && w.branch.trim() !== ''
  }
  // Why: hosts that predate isMainWorktree in worktree.ps; main/master is the only signal.
  const branch = w.branch.replace(/^refs\/heads\//, '')
  return branch === 'main' || branch === 'master'
}

/** The facts the shared Workspace options filters read, from what the host stamped on each row. */
function phoneRowFacts(
  repoHostIdByRepoId: ReadonlyMap<string, ExecutionHostId>
): WorkspaceRowFactReader<Worktree> {
  return {
    isArchived: (w) => w.isArchived === true,
    isFolderWorkspace: (w) => w.workspaceKind === 'folder-workspace',
    repoId: (w) => w.repoId,
    hostId: (w) => resolveWorktreeHostId(w, repoHostIdByRepoId),
    isOtherClient: (w) => w.desktopOtherClient === true,
    isDefaultBranch: (w) => w.defaultBranch ?? guessDefaultBranchWorkspace(w),
    isAutomationCreated: (w) => w.automationCreated === true,
    isCliCreated: (w) => w.cliCreated === true,
    isDetachedHead: (w) => w.detachedHead === true,
    // Why the guess: #8873's exemption must fail open on hosts that predate isMainWorktree.
    isMainWorktree: (w) => w.isMainWorktree ?? guessDefaultBranchWorkspace(w),
    isSleeping: (w) => !isWorktreeActive(w)
  }
}

function orderMainWorktreeFirst(worktrees: Worktree[]): Worktree[] {
  const mainWorktrees = worktrees.filter((worktree) => worktree.isMainWorktree)
  if (mainWorktrees.length === 0) {
    return worktrees
  }
  return [...mainWorktrees, ...worktrees.filter((worktree) => !worktree.isMainWorktree)]
}

export function filterWorktrees(
  worktrees: Worktree[],
  filters: FilterState,
  search: string,
  repoHostIdByRepoId: ReadonlyMap<string, ExecutionHostId> = new Map()
): Worktree[] {
  const result = filterWorkspaceRows(worktrees, filters, phoneRowFacts(repoHostIdByRepoId))
  const q = search.trim().toLowerCase()
  if (!q) {
    return result
  }
  return result.filter(
    (w) =>
      w.displayName.toLowerCase().includes(q) ||
      w.branch.toLowerCase().includes(q) ||
      w.repo.toLowerCase().includes(q)
  )
}

export function isWorktreePinned(w: Worktree, localPins: Set<string>): boolean {
  return w.isPinned || localPins.has(w.worktreeId)
}

// Visible pinned rows plus their lineage descendants, walking through filtered-out rows as desktop does.
function getPinnedSectionIdentities(
  worktrees: readonly Worktree[],
  visible: readonly Worktree[],
  pinnedIds: Set<string>
): Set<string> {
  const childrenByParentId = getMobileWorkspaceLineageChildren(worktrees)
  const identities = new Set(
    visible.filter((w) => isWorktreePinned(w, pinnedIds)).map((w) => getWorktreeRowIdentity(w))
  )
  // A Set iterates entries added mid-loop and ignores repeats, so this walks descendants and stops on cycles.
  for (const identity of identities) {
    for (const child of childrenByParentId.get(identity) ?? []) {
      identities.add(getWorktreeRowIdentity(child))
    }
  }
  return identities
}

export function buildSections(
  worktrees: Worktree[],
  sortMode: WorkspaceSortBy,
  filters: FilterState,
  search: string,
  groupMode: WorkspaceGroupBy,
  pinnedIds: Set<string>,
  projectCatalog: ProjectSectionCatalog = NO_PROJECT_SECTION_CATALOG,
  workspaceStatuses: readonly WorkspaceStatusDefinition[] = DEFAULT_WORKSPACE_STATUSES,
  collapsedGroups: ReadonlySet<string> = new Set(),
  showPinnedInGroups = false,
  repoHostIdByRepoId: ReadonlyMap<string, ExecutionHostId> = new Map()
): Section[] {
  const filtered = filterWorktrees(worktrees, filters, search, repoHostIdByRepoId)
  const sorted = sortWorktrees(filtered, sortMode)

  const pinnedIdentities = getPinnedSectionIdentities(worktrees, sorted, pinnedIds)
  const isInPinned = (w: Worktree) => pinnedIdentities.has(getWorktreeRowIdentity(w))
  const pinned = sorted.filter(isInPinned)
  const canonicalGroupWorktrees = showPinnedInGroups ? sorted : sorted.filter((w) => !isInPinned(w))

  const sections: Section[] = []
  if (pinned.length > 0) {
    sections.push(makeSection('pinned', 'Pinned', pinned, collapsedGroups, { icon: 'pin' }))
  }

  if (groupMode === 'none') {
    if (canonicalGroupWorktrees.length > 0) {
      sections.push(makeSection('all', 'All', canonicalGroupWorktrees, collapsedGroups))
    }
  } else if (groupMode === 'repo') {
    const representedRepoIds = new Set(worktrees.map((w) => w.repoId))
    const query = search.trim().toLowerCase()
    const placeholderRepoIds = projectCatalog.repos
      .filter(
        (repo) =>
          !representedRepoIds.has(repo.id) &&
          (filters.filterRepoIds.length === 0 || filters.filterRepoIds.includes(repo.id)) &&
          (!query || repo.displayName.toLowerCase().includes(query))
      )
      .map((repo) => repo.id)
    // Why: the desktop sidebar's own grouping, so keys, labels and order match it.
    const projectSections = withRepoSectionDisplayLabels(
      buildProjectSections({
        items: canonicalGroupWorktrees,
        repoIdOf: (w) => w.repoId,
        repoMap: buildSectionRepoMap(projectCatalog.repos, worktrees),
        projectIndex: buildProjectGroupingIndex(projectCatalog.grouping ?? undefined),
        placeholderRepoIds,
        repoOrder: projectCatalog.repoOrder,
        projectOrderBy: projectCatalog.projectOrderBy
      })
    )
    for (const [key, section] of projectSections) {
      sections.push(
        makeSection(key, section.label, orderMainWorktreeFirst(section.items), collapsedGroups, {
          repo: section.repo
        })
      )
    }
  } else if (groupMode === 'workspace-status') {
    const renderableWorkspaceStatuses = withDefaultWorkspaceStatuses(workspaceStatuses)
    const byStatus = new Map<string, Worktree[]>()
    for (const w of canonicalGroupWorktrees) {
      const key = getWorkspaceStatus(w, renderableWorkspaceStatuses)
      const list = byStatus.get(key)
      if (list) {
        list.push(w)
      } else {
        byStatus.set(key, [w])
      }
    }
    for (const status of renderableWorkspaceStatuses) {
      const items = byStatus.get(status.id)
      if (items && items.length > 0) {
        sections.push(
          makeSection(getWorkspaceStatusGroupKey(status.id), status.label, items, collapsedGroups)
        )
      }
    }
  } else if (groupMode === 'pr-status') {
    const byGroup = new Map<string, Worktree[]>()
    for (const w of canonicalGroupWorktrees) {
      const key = getPRGroupKeyForState(w.linkedPR?.state)
      const list = byGroup.get(key)
      if (list) {
        list.push(w)
      } else {
        byGroup.set(key, [w])
      }
    }
    for (const groupKey of PR_GROUP_ORDER) {
      const items = byGroup.get(groupKey)
      if (items && items.length > 0) {
        sections.push(
          makeSection(getPRLaneKey(groupKey), PR_GROUP_LABELS[groupKey], items, collapsedGroups)
        )
      }
    }
  }

  return sections
}
