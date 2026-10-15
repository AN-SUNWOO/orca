import { Globe } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import {
  classifyExplicitUrl,
  classifyHostUrl
} from '@/components/tab-bar/tab-create-entry-url-classification'
import { isCmdJPaletteQueryTooLarge } from './palette-results'
import { getBrowserWorkspaceActionAvailability } from './quick-action-context'
import type { CmdJQuickAction } from './quick-actions'

export const BROWSER_NAVIGATION_ACTION_ID = 'navigate-to-url'

export function buildCmdJBrowserNavigationAction(query: string): CmdJQuickAction | null {
  const input = query.trim()
  if (!input || isCmdJPaletteQueryTooLarge(input)) {
    return null
  }
  const target = classifyExplicitUrl(input) ?? classifyHostUrl(input)
  if (!target || target.kind === 'blocked') {
    return null
  }
  return {
    id: BROWSER_NAVIGATION_ACTION_ID,
    kind: 'action',
    title: translate('worktreeJumpPalette.goToWebsite', 'Go to {{value0}}', { value0: input }),
    description: translate('worktreeJumpPalette.openWebsiteInNewTab', 'Open in a new browser tab'),
    icon: Globe,
    verbKeywords: [],
    sourceQuery: input,
    isAvailable: getBrowserWorkspaceActionAvailability,
    run: async (context) => {
      const availability = getBrowserWorkspaceActionAvailability(context)
      if (!availability.available) {
        return { status: 'unavailable', reason: availability.reason }
      }
      if (!context.activeGroupId) {
        return { status: 'unavailable', reason: 'no-active-group' }
      }
      await context.openNewBrowserTab(context.activeGroupId, target.url)
      return { status: 'ok' }
    }
  }
}
