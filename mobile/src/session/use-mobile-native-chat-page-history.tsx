import { Fragment, useCallback, useMemo, useState, type ReactElement } from 'react'
import { Platform } from 'react-native'

const NO_ROWS: readonly never[] = []

type Row<TItem> = { item: TItem; index: number }

/** RN Web's list draws rows by index, so rows added at the front push the ones a reader is on out
 *  of what it draws. On the page, rows that arrive above the list's first row go in its header
 *  instead: the list's own rows keep their indexes and stay drawn. */
export function useMobileNativeChatPageHistory<TItem>(
  rows: readonly TItem[],
  renderRow: (row: Row<TItem>) => ReactElement,
  keys: { keyOf: (row: TItem) => string; current: (key: string) => string | undefined }
): {
  listRows: readonly TItem[]
  renderListRow: (row: Row<TItem>) => ReactElement
  /** The list header: what was given, then the history loaded above the list's own rows. */
  withHistory: (header: ReactElement | null) => ReactElement | null
} {
  const onPage = Platform.OS === 'web'
  // The row the list starts at, for as long as that row, or the row its messages joined, exists.
  const [headId, setHeadId] = useState<string | null>(null)
  const { keyOf, current } = keys
  const head = headId === null ? undefined : current(headId)
  const headIndex = useMemo(
    () => (onPage && head !== undefined ? rows.findIndex((row) => keyOf(row) === head) : -1),
    [onPage, head, rows, keyOf]
  )
  const nextHead = headIndex !== -1 ? head : rows.length > 0 ? keyOf(rows[0]) : undefined
  if (onPage && nextHead !== undefined && nextHead !== headId) {
    setHeadId(nextHead)
  }
  const historyCount = Math.max(headIndex, 0)
  const historyRows = useMemo(
    () => (historyCount === 0 ? NO_ROWS : rows.slice(0, historyCount)),
    [historyCount, rows]
  )
  const listRows = useMemo(
    () => (historyCount === 0 ? rows : rows.slice(historyCount)),
    [historyCount, rows]
  )
  const renderOffsetRow = useCallback(
    (row: Row<TItem>) => renderRow({ item: row.item, index: row.index + historyCount }),
    [renderRow, historyCount]
  )
  const withHistory = useCallback(
    (header: ReactElement | null) =>
      historyRows.length === 0 ? (
        header
      ) : (
        <>
          {header}
          {historyRows.map((item, index) => (
            <Fragment key={keyOf(item)}>{renderRow({ item, index })}</Fragment>
          ))}
        </>
      ),
    [historyRows, renderRow, keyOf]
  )
  return {
    listRows,
    renderListRow: historyCount === 0 ? renderRow : renderOffsetRow,
    withHistory
  }
}
