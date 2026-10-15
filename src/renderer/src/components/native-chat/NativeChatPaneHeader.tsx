import { SquareSplitVertical, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useShortcutKeyDetails } from '@/hooks/useShortcutLabel'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { agentForksConversations } from '../../../../shared/agent-resume-argv'
import type { NativeChatTabSession } from '../tab-bar/tab-session-history-switch'
import { useSystemPrefersDark } from '../terminal-pane/use-system-prefers-dark'
import { useStructuredChatPaneActions } from './use-structured-chat-pane-actions'
import { NativeChatResumeInCliButton } from './NativeChatResumeInCliButton'

const HEADER_STYLE: React.CSSProperties & Record<'--orca-pane-title-bg', string> = {
  '--orca-pane-title-bg': 'var(--chat-canvas)'
}

export function NativeChatPaneHeader({
  tabId,
  worktreeId,
  groupId,
  nativeChat,
  focused,
  colorScheme
}: {
  tabId: string
  worktreeId: string
  groupId: string
  nativeChat: NativeChatTabSession
  focused: boolean
  colorScheme: React.CSSProperties['colorScheme']
}): React.JSX.Element {
  const actions = useStructuredChatPaneActions(tabId, worktreeId, groupId)
  const theme = useAppStore((state) => state.settings?.theme)
  const systemDark = useSystemPrefersDark()
  const light = colorScheme
    ? colorScheme === 'light'
    : theme === 'light' || (theme === 'system' && !systemDark)
  const split = translate('components.native-chat.splitRight', 'Split Chat Right')
  const splitShortcut = useShortcutKeyDetails('terminal.splitRight')
  return (
    <div
      className="pane-title-bar z-20"
      data-chromeless=""
      data-active-pane={focused ? '' : undefined}
      data-pane-title-surface={light ? 'light' : 'dark'}
      style={HEADER_STYLE}
    >
      <div className="pane-title-actions ml-auto flex shrink-0 items-center gap-0">
        {nativeChat.agent && agentForksConversations(nativeChat.agent) ? (
          <NativeChatResumeInCliButton
            tabId={tabId}
            worktreeId={worktreeId}
            nativeChat={nativeChat}
          />
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="pane-title"
              size="icon-xs"
              aria-label={split}
              onClick={(event) => {
                event.stopPropagation()
                actions.onSplitRight()
              }}
            >
              <SquareSplitVertical className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {split}
            <ShortcutKeyCombo keys={splitShortcut.keys} doubleTap={splitShortcut.doubleTap} />
          </TooltipContent>
        </Tooltip>
        {actions.canClosePane ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="pane-title-close"
                size="icon-xs"
                aria-label={actions.closeLabel}
                onClick={(event) => {
                  event.stopPropagation()
                  actions.onClosePane()
                }}
              >
                <X className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              {actions.closeLabel}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  )
}
