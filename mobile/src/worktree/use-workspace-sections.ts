import { useMemo } from 'react'
import type { WorkspaceStatusDefinition } from '../../../src/shared/worktree/types'
import type { MobileGroupMode, MobileSortMode } from './workspace-view-settings'
import {
  buildSectionRepoMap,
  buildSections,
  type FilterState,
  type ProjectSectionCatalog,
  type Section,
  type SectionRepo,
  type Worktree
} from './workspace-list-sections'
import { buildFilterRepos, type WorkspaceSectionRepo } from './workspace-filter-repos'

export function useWorkspaceSections(args: {
  displayWorktrees: Worktree[]
  sortMode: MobileSortMode
  filters: FilterState
  search: string
  groupMode: MobileGroupMode
  pinnedIds: Set<string>
  showPinnedInGroups: boolean
  projectCatalog: ProjectSectionCatalog
  /** Every catalog repo on every host, which is what the desktop's filter lists. */
  filterCatalogRepos: readonly SectionRepo[]
  collapsedGroups: Set<string>
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
}): {
  sections: Section[]
  rawSections: Section[]
  uniqueRepos: WorkspaceSectionRepo[]
  /** Each row's repo by id, as the desktop's cards look theirs up for colour and icon. */
  repoById: ReadonlyMap<string, SectionRepo>
} {
  const {
    displayWorktrees,
    sortMode,
    filters,
    search,
    groupMode,
    pinnedIds,
    showPinnedInGroups,
    projectCatalog,
    filterCatalogRepos,
    collapsedGroups,
    workspaceStatuses
  } = args

  const uniqueRepos = useMemo(
    () => buildFilterRepos(filterCatalogRepos, displayWorktrees),
    [filterCatalogRepos, displayWorktrees]
  )

  const repoById = useMemo(
    () => buildSectionRepoMap(projectCatalog.repos, displayWorktrees),
    [projectCatalog.repos, displayWorktrees]
  )

  const rawSections = useMemo(
    () =>
      buildSections(
        displayWorktrees,
        sortMode,
        filters,
        search,
        groupMode,
        pinnedIds,
        projectCatalog,
        workspaceStatuses,
        collapsedGroups,
        showPinnedInGroups
      ),
    [
      displayWorktrees,
      sortMode,
      filters,
      search,
      groupMode,
      pinnedIds,
      projectCatalog,
      workspaceStatuses,
      collapsedGroups,
      showPinnedInGroups
    ]
  )

  const sections = useMemo(
    () =>
      rawSections.map((s) => ({
        ...s,
        data: collapsedGroups.has(s.key) ? [] : s.data
      })),
    [rawSections, collapsedGroups]
  )

  return { sections, rawSections, uniqueRepos, repoById }
}
