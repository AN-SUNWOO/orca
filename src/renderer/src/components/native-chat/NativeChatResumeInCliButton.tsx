import { useState } from 'react'
import { SquareTerminal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate } from '@/i18n/i18n'
import { useTabSessionLaunchActions } from '../tab-bar/use-tab-session-launch-actions'
import {
  lookupTabSessionHistoryRow,
  resolveTabSessionHistorySubject,
  resolveTabSessionSwitch,
  type NativeChatTabSession
} from '../tab-bar/tab-session-history-switch'

export function NativeChatResumeInCliButton({
  tabId,
  worktreeId,
  nativeChat
}: {
  tabId: string
  worktreeId: string
  nativeChat: NativeChatTabSession
}): React.JSX.Element {
  const [pending, setPending] = useState(false)
  const launch = useTabSessionLaunchActions(worktreeId)
  const label = translate(
    'auto.components.right.sidebar.AiVaultSessionRow.resumeInNewCli',
    'Resume in New CLI'
  )
  const unavailable = () =>
    toast.error(
      translate(
        'auto.components.right.sidebar.AiVaultPanel.resumeInNewCliUnavailable',
        'This session cannot be opened in the CLI.'
      )
    )
  const resume = async (): Promise<void> => {
    const subject = resolveTabSessionHistorySubject(useAppStore.getState(), {
      tab: { id: tabId, worktreeId },
      nativeChat
    })
    if (!subject) {
      unavailable()
      return
    }
    const row = await lookupTabSessionHistoryRow(
      subject,
      (args) => window.api.aiVault.listSessions(args),
      {
        requestToken: createBrowserUuid(),
        isCancelled: () => false,
        userRequested: true
      }
    )
    const move = row ? resolveTabSessionSwitch(useAppStore.getState(), row, subject) : null
    if (row && move?.action === 'resume-in-new-cli') {
      launch.handleResumeInNewCli(row, move.worktreeId)
    } else {
      unavailable()
    }
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="pane-title"
          size="icon-xs"
          aria-label={label}
          disabled={pending}
          onClick={(event) => {
            event.stopPropagation()
            setPending(true)
            void resume()
              .catch(unavailable)
              .finally(() => setPending(false))
          }}
        >
          <SquareTerminal className="size-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
