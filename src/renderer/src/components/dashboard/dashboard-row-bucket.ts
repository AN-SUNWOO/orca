import type { DashboardAgentRow } from './useDashboardData'
import {
  dashboardCardDisplayState,
  type DashboardBucket,
  type DashboardCardDotState
} from '../../../../shared/dashboard-snapshot'
import { dashboardBucketForDotState } from './dashboard-card-bucket'
import type { AgentRowState } from '@/lib/agent-row-decay-state'
import { isAgentTurnUnacknowledged } from '@/attention/agent-attention-acknowledgement'

/**
 * Project a row state onto the published card vocabulary.
 *
 * `unverifiable` stays renderer-local: `DashboardCardDotState` is validated against a fixed
 * allowlist in main (`dashboard-payload-validation.ts`) and read by pop-out windows that may
 * predate the member, so a new value would be dropped rather than rendered. Publishing today's
 * `idle` keeps those surfaces at today's behavior instead of silently losing the card.
 */
export function dashboardCardDotState(state: AgentRowState): DashboardCardDotState {
  return state === 'unverifiable' ? 'idle' : state
}

/**
 * The one unread (bold) rule for an agent row, on every surface that draws one.
 *
 * Why title/process-derived rows (`startedAt === 0`) are never unread: they restamp
 * `stateStartedAt` on every rebuild and have no turn record, so auto-acknowledgement could never
 * clear them; their pane's completion still marks the tab and workspace unread.
 */
export function isAgentRowUnseen(
  row: { startedAt: number; entry: { stateStartedAt: number } },
  acknowledgedAt: number
): boolean {
  return isAgentTurnUnacknowledged(
    acknowledgedAt,
    row.startedAt === 0 ? null : row.entry.stateStartedAt
  )
}

export type DashboardRowBucketProjection = {
  isTitleDerived: boolean
  dotState: DashboardCardDotState
  workingMode: DashboardAgentRow['entry']['workingMode']
  unseen: boolean
  bucket: DashboardBucket
}

/** Derive the shared dashboard presentation state for one agent row. */
export function dashboardRowBucketProjection(
  row: Pick<DashboardAgentRow, 'paneKey' | 'entry' | 'state' | 'startedAt'>,
  acknowledgedAgentsByPaneKey?: Record<string, number>
): DashboardRowBucketProjection {
  const isTitleDerived = row.startedAt === 0
  const dotState = dashboardCardDotState(row.state)
  const workingMode =
    row.state === 'working' && row.entry.workingMode === 'monitoring'
      ? row.entry.workingMode
      : undefined
  const unseen = isAgentRowUnseen(row, acknowledgedAgentsByPaneKey?.[row.paneKey] ?? 0)
  const bucket = dashboardBucketForDotState(
    dashboardCardDisplayState({ dotState, workingMode, unseen })
  )

  return { isTitleDerived, dotState, workingMode, unseen, bucket }
}
