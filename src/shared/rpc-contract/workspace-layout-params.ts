import { z } from 'zod'

export const LayoutSubscribeParams = z
  .object({
    /** Workspace keys to receive; every workspace when absent or 'all'. */
    workspaces: z.union([z.literal('all'), z.array(z.string().min(1))]).optional()
  })
  .nullish()

export const LayoutUnsubscribeParams = z.object({
  subscriptionId: z.string().min(1, 'Missing subscriptionId')
})

const SplitPaneCommand = z.object({
  type: z.literal('splitPane'),
  workspace: z.string().min(1),
  tabId: z.string().min(1),
  leafId: z.string().min(1),
  direction: z.enum(['horizontal', 'vertical'])
})

/**
 * A window's layout command (`layout.apply`, registered only in a layout-owner build). The window
 * names what it acts on; main mints every new id, so no new id is accepted here.
 */
export const LayoutApplyParams = z.object({
  command: z.discriminatedUnion('type', [SplitPaneCommand])
})
