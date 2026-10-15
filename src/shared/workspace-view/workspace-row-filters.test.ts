import { describe, expect, it } from 'vitest'
import {
  filterWorkspaceRows,
  type WorkspaceRowFactReader,
  type WorkspaceRowFilters
} from './workspace-row-filters'
import { buildWorkspaceRowComparator, recentActivityWithCreateGrace } from './workspace-row-sort'

type Row = { id: string; folder?: boolean; facts?: Partial<Record<string, boolean>> }

const read: WorkspaceRowFactReader<Row> = {
  isArchived: () => false,
  isFolderWorkspace: (row) => row.folder === true,
  repoId: () => 'repo',
  hostId: () => 'local',
  isOtherClient: (row) => row.facts?.otherClient === true,
  isDefaultBranch: (row) => row.facts?.defaultBranch === true,
  isAutomationCreated: (row) => row.facts?.automation === true,
  isCliCreated: (row) => row.facts?.cli === true,
  isDetachedHead: (row) => row.facts?.detached === true,
  isMainWorktree: (row) => row.facts?.main === true,
  isSleeping: (row) => row.facts?.sleeping !== false
}

const everyFilterOn: WorkspaceRowFilters = {
  hideSleepingWorkspaces: true,
  alwaysShowDefaultBranchWorkspace: false,
  hideDefaultBranchWorkspace: true,
  hideAutomationGeneratedWorkspaces: true,
  hideCliCreatedWorkspaces: true,
  hideDetachedHeadWorkspaces: true,
  hideWorkspacesFromOtherDevices: true,
  filterRepoIds: ['other-repo'],
  visibleHostIds: ['local']
}

describe('filterWorkspaceRows', () => {
  it('keeps a folder workspace through every filter but the host and other-client ones', () => {
    expect(filterWorkspaceRows([{ id: 'f', folder: true }], everyFilterOn, read)).toHaveLength(1)
    expect(
      filterWorkspaceRows(
        [{ id: 'f', folder: true, facts: { otherClient: true } }],
        everyFilterOn,
        read
      )
    ).toHaveLength(0)
    expect(
      filterWorkspaceRows(
        [{ id: 'f', folder: true }],
        { ...everyFilterOn, visibleHostIds: [] },
        read
      )
    ).toHaveLength(0)
  })

  it('shows an awake row whose kind facts are missing', () => {
    const filters = { ...everyFilterOn, filterRepoIds: [] }
    expect(
      filterWorkspaceRows([{ id: 'r', facts: { sleeping: false } }], filters, read)
    ).toHaveLength(1)
  })
})

describe('buildWorkspaceRowComparator', () => {
  it('does not apply create grace to non-finite createdAt values', () => {
    expect(recentActivityWithCreateGrace(10, Number.NaN, 0)).toBe(10)
    expect(recentActivityWithCreateGrace(10, Number.POSITIVE_INFINITY, 0)).toBe(10)
  })

  it('puts unranked rows after ranked ones under manual order, then by name', () => {
    const ranks: Record<string, number | null> = { a: null, b: 1, c: 5, d: null }
    const compare = buildWorkspaceRowComparator<string>('manual', {
      label: (id) => id,
      repoLabel: () => '',
      recentActivity: () => 0,
      manualRank: (id) => ranks[id] ?? null,
      compareSmart: () => 0
    })
    expect(['d', 'a', 'b', 'c'].sort(compare)).toEqual(['c', 'b', 'a', 'd'])
  })
})
