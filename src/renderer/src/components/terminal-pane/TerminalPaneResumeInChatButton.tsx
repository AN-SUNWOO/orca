import { useShallow } from 'zustand/react/shallow'
import { useState } from 'react'
import { MessagesSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  cliChatResumeNeedsConfirmation,
  resolveCliChatResumeSource
} from '../tab-bar/cli-chat-resume-source'
import { runCliChatResume, useCliChatResumePending } from '../tab-bar/cli-chat-resume-run'
import { StopAndSwitchToChatDialog } from '../tab-bar/StopAndSwitchToChatDialog'

export function TerminalPaneResumeInChatButton({
  tabId,
  worktreeId,
  paneKey
}: {
  tabId: string
  worktreeId: string
  paneKey: string
}): React.JSX.Element {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const source = useAppStore(
    useShallow((state) =>
      resolveCliChatResumeSource(state, {
        tab: { id: tabId, worktreeId },
        paneKey
      })
    )
  )
  const pending = useCliChatResumePending(source)
  const needsConfirmation = useAppStore((state) =>
    source ? cliChatResumeNeedsConfirmation(state, source) : true
  )
  const label = translate(
    needsConfirmation ? 'components.native-chat.stopAndSwitch.action' : 'components.native-chat.switch.action',
    needsConfirmation ? 'Stop and Switch to Chat (closes terminal)' : 'Switch to Chat (closes terminal)'
  )

  return (
    <>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          // Same class as split so it shares the hover/active reveal.
          className="pane-title-split-trigger"
          aria-label={label}
          disabled={!source || pending}
          aria-busy={pending || undefined}
          onClick={(event) => {
            event.stopPropagation()
            if (source) {
              if (needsConfirmation) {
                setConfirmOpen(true)
              } else {
                void runCliChatResume(source, true, true)
              }
            }
          }}
        >
          <MessagesSquare className="size-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
    {source ? <StopAndSwitchToChatDialog
      source={source}
      open={confirmOpen}
      onCancel={() => setConfirmOpen(false)}
      onConfirm={() => {
        setConfirmOpen(false)
        void runCliChatResume(source, true, true)
      }}
    /> : null}
    </>
  )
}
