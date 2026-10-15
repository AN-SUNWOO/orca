import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import { agentLabel } from '../../../../shared/ai-vault-session-filters'
import type { CliChatResumeSource } from './cli-chat-resume-source'

export function StopAndSwitchToChatDialog({
  source,
  open,
  onCancel,
  onConfirm
}: {
  source: CliChatResumeSource
  open: boolean
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const agent = agentLabel(source.agent)
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-sm">
            {translate('components.native-chat.stopAndSwitch.title',
              'Stop {{agent}} and continue in chat?', { agent })}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {translate('components.native-chat.stopAndSwitch.description',
              'This closes the terminal and stops the current step. Everything saved so far stays in the conversation.')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {translate('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={onConfirm}>
            {translate('components.native-chat.stopAndSwitch.confirm', 'Stop and Switch')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
