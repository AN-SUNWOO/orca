import { sendLayoutCommandToOwner } from '@/runtime/layout-owner-command'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../../shared/layout-owner-switch'

/** Equalizes a tab's panes, then `then` runs (focus); in a layout-owner build main equalizes first. */
export function equalizeTerminalPanes(
  pane: { worktreeId: string; tabId: string; getManager: () => PaneManager | null },
  then: (manager: PaneManager) => void
): void {
  const equalize = (): void => {
    const manager = pane.getManager()
    if (manager) {
      manager.equalizePaneSizes()
      then(manager)
    }
  }
  // Switch point: main equalizes the tab first; the window then redraws it.
  if (
    ORCA_LAYOUT_OWNER_IS_MAIN &&
    sendLayoutCommandToOwner(
      pane.worktreeId,
      { type: 'equalizePanes', tabId: pane.tabId },
      { apply: equalize, asToday: equalize }
    )
  ) {
    return
  }
  equalize()
}
