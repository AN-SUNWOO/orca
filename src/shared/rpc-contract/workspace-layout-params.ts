import { z } from 'zod'
import { TerminalPaneLayoutNodeSchema } from './session-tabs-schemas-params'
import { TerminalOrphanGroupLayout } from './terminal-orphan-params'

export const LayoutSubscribeParams = z
  .object({
    /** Workspace keys to receive; every workspace when absent or 'all'. */
    workspaces: z.union([z.literal('all'), z.array(z.string().min(1))]).optional()
  })
  .nullish()

export const LayoutUnsubscribeParams = z.object({
  subscriptionId: z.string().min(1, 'Missing subscriptionId')
})

const OnPane = {
  workspace: z.string().min(1),
  tabId: z.string().min(1),
  leafId: z.string().min(1)
}

const SplitPaneCommand = z.object({
  type: z.literal('splitPane'),
  ...OnPane,
  direction: z.enum(['horizontal', 'vertical'])
})

/** Main marks a close as the user's; the window cannot send that mark. */
const ClosePaneCommand = z.object({ type: z.literal('closePane'), ...OnPane })

/** A title is trimmed and non-empty; null clears it. */
const RenamePaneCommand = z.object({
  type: z.literal('renamePane'),
  ...OnPane,
  title: z.union([z.string().trim().min(1), z.null()])
})

const MovePaneCommand = z.object({
  type: z.literal('movePane'),
  ...OnPane,
  targetLeafId: z.string().min(1),
  side: z.enum(['left', 'right', 'top', 'bottom'])
})

/** The tab's tree with its new ratios; main refuses one whose panes differ from its own. */
const SetPaneRatiosCommand = z.object({
  type: z.literal('setPaneRatios'),
  workspace: OnPane.workspace,
  tabId: OnPane.tabId,
  root: TerminalPaneLayoutNodeSchema
})

const EqualizePanesCommand = z.object({
  type: z.literal('equalizePanes'),
  workspace: OnPane.workspace,
  tabId: OnPane.tabId
})

const OnTab = { workspace: OnPane.workspace, tabId: OnPane.tabId }

/** Within one group too: a reorder is a move to the tab's own group. */
const MoveTabCommand = z.object({
  type: z.literal('moveTab'),
  ...OnTab,
  toGroupId: z.string().min(1),
  index: z.number().int().nonnegative()
})

/** Main mints the new group's id, or moves a lone tab's group whole. */
const SplitGroupCommand = z.object({
  type: z.literal('splitGroup'),
  ...OnTab,
  besideGroupId: z.string().min(1),
  direction: z.enum(['left', 'right', 'up', 'down'])
})

/** The workspace's group tree with its new ratios; main refuses one whose groups differ. */
const SetGroupRatiosCommand = z.object({
  type: z.literal('setGroupRatios'),
  workspace: OnPane.workspace,
  groupLayout: TerminalOrphanGroupLayout
})

/** The window's close of one tab it already closed; main records it, the window's reason kept. */
const CloseTabsCommand = z.object({
  type: z.literal('closeTabs'),
  workspace: OnPane.workspace,
  tabIds: z.tuple([z.string().min(1)]),
  recordClose: z.enum(['user', 'cleanup'])
})

/**
 * A window's layout command (`layout.apply`, registered only in a layout-owner build). The window
 * names what it acts on; main mints every new id, so no new id is accepted here.
 */
export const LayoutApplyParams = z.object({
  command: z.discriminatedUnion('type', [
    SplitPaneCommand,
    ClosePaneCommand,
    RenamePaneCommand,
    EqualizePanesCommand,
    MovePaneCommand,
    SetPaneRatiosCommand,
    MoveTabCommand,
    SplitGroupCommand,
    SetGroupRatiosCommand,
    CloseTabsCommand
  ])
})
