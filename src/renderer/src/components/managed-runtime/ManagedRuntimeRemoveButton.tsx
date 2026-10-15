import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

/** Settings' delete of the runtime Orca downloaded, behind a confirmation: it stops running chats. */
export function ManagedRuntimeRemoveButton(props: {
  agentLabel: string
  disabled: boolean
  onRemove: () => void
}): React.JSX.Element {
  const { agentLabel, disabled, onRemove } = props
  const [confirming, setConfirming] = useState(false)
  const label = translate('components.managed-runtime.remove', 'Remove downloaded runtime')
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-xs"
            variant="ghost"
            disabled={disabled}
            aria-label={label}
            onClick={() => setConfirming(true)}
          >
            <Trash2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {translate(
                'components.managed-runtime.removeTitle',
                'Remove {{agent}} from this host?',
                { agent: agentLabel }
              )}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'components.managed-runtime.removeDescription',
                'Running {{agent}} chats stop. Chat history is kept.',
                { agent: agentLabel }
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {translate('components.managed-runtime.removeKeep', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirming(false)
                onRemove()
              }}
            >
              {translate('components.managed-runtime.removeConfirm', 'Remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
