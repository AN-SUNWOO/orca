import { useState } from 'react'
import { useAppStore } from '@/store'
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { AiVaultSessionSurfaceSwitchMenuItems } from '../right-sidebar/AiVaultSessionSurfaceSwitchMenuItems'
import { cliChatResumeNeedsConfirmation, resolveCliChatResumeSource } from './cli-chat-resume-source'
import { runCliChatResume, useCliChatResumePending } from './cli-chat-resume-run'
import { StopAndSwitchToChatDialog } from './StopAndSwitchToChatDialog'
import { translate } from '@/i18n/i18n'

export function CliChatResumeMenuItems({
  tab,
  leadingSeparator,
  onComplete
}: {
  tab: Pick<TerminalTab, 'id' | 'worktreeId'>
  leadingSeparator: boolean
  onComplete?: () => void
}): React.JSX.Element | null {
  const [source] = useState(() => resolveCliChatResumeSource(useAppStore.getState(), { tab }))
  const [confirmOpen, setConfirmOpen] = useState(false)
  const pending = useCliChatResumePending(source)
  const needsConfirmation = useAppStore((state) =>
    source ? cliChatResumeNeedsConfirmation(state, source) : true
  )
  if (!source) {
    return null
  }
  return (
    <>
      {leadingSeparator ? <DropdownMenuSeparator /> : null}
      <AiVaultSessionSurfaceSwitchMenuItems
        menuKind="dropdown"
        tooltipSide="right"
        chatPending={pending}
        chatLabel={translate(
          needsConfirmation ? 'components.native-chat.stopAndSwitch.action' : 'components.native-chat.switch.action',
          needsConfirmation ? 'Stop and Switch to Chat (closes terminal)' : 'Switch to Chat (closes terminal)'
        )}
        onResumeInNewChat={(event) => {
          event.preventDefault()
          if (needsConfirmation) {
            setConfirmOpen(true)
          } else {
            void runCliChatResume(source, false, true).finally(() => onComplete?.())
          }
        }}
      />
      <StopAndSwitchToChatDialog
        source={source}
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false)
          void runCliChatResume(source, false, true).finally(() => onComplete?.())
        }}
      />
    </>
  )
}
