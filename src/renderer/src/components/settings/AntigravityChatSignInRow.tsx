import { useEffect, useSyncExternalStore } from 'react'
import { Check, Copy } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useClipboardTextCopyFeedback } from '@/hooks/use-clipboard-text-copy-feedback'
import {
  antigravityChatSignInRunning as running,
  cancelAntigravityChatSignIn,
  observeAntigravityChatSignIn,
  readAntigravityChatSignIn,
  startAntigravityChatSignIn,
  subscribeAntigravityChatSignIns
} from '@/runtime/antigravity-chat-sign-in-status'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { AntigravityChatSignInState } from '../../../../shared/antigravity-account-types'
import type { ManagedRuntimeInstallObservation } from '@/runtime/use-managed-runtime-install'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

type Flow = AntigravityChatSignInState

function chatSignInLine(flow: Flow | null, saved: boolean, openFailed: boolean, host: string) {
  switch (flow?.phase) {
    case 'starting':
      return translate('accounts.antigravity.chatStarting', 'Starting sign-in…')
    case 'waiting':
      return openFailed
        ? translate(
            'accounts.antigravity.chatOpenFailed',
            'Copy the link and open it in your browser.'
          )
        : translate('accounts.antigravity.chatWaiting', 'Finish signing in in your browser.')
    case 'signedIn':
      return translate('accounts.antigravity.chatSignedIn', 'Signed in.')
    case 'cancelled':
      return translate('accounts.antigravity.chatCancelled', 'Sign-in cancelled.')
    case 'expired':
      return translate('accounts.antigravity.chatExpired', 'Sign-in timed out. Try again.')
    case 'failed':
    case undefined:
      // A saved file may since have been revoked, so this never claims the sign-in works.
      return saved
        ? translate('accounts.antigravity.chatSaved', 'Sign-in saved on {{host}}.', { host })
        : translate('accounts.antigravity.chatSignedOut', 'Sign in on {{host}}.', { host })
  }
}

function signInButtonLabel(flow: Flow | null, saved: boolean, error: string | null): string {
  if (
    error ||
    flow?.phase === 'failed' ||
    flow?.phase === 'cancelled' ||
    flow?.phase === 'expired'
  ) {
    return translate('accounts.antigravity.chatRetry', 'Retry sign-in')
  }
  return flow?.phase === 'signedIn' || (!flow && saved)
    ? translate('accounts.antigravity.chatChangeAccount', 'Change account')
    : translate('accounts.antigravity.chatSignIn', 'Sign in')
}

/** Chats sign in on the host itself, never in a WSL distro; a remote host's Google page returns to
 *  that host, so remote sign-in waits for callback forwarding. */
export function hostOffersAntigravityChatSignIn(owner: RuntimeClientTarget): boolean {
  return owner.kind === 'local'
}

const SETTLED_OPERATION_PHASES = new Set(['succeeded', 'failed', 'cancelled'])

/** Sign-in runs the installed server, so it waits while the host reports nothing to run or a
 *  Remove still runs; an Update keeps the old copy running until it lands. The install row beside
 *  it says why. A status the host could not report leaves it to the host. */
export function antigravityChatSignInBlocked(
  install: Extract<ManagedRuntimeInstallObservation, { kind: 'active' }>
): boolean {
  const { snapshot } = install
  if (snapshot.kind !== 'known') {
    return snapshot.kind === 'unknown'
  }
  const { source, operation } = snapshot.state
  return !source || (operation?.kind === 'remove' && !SETTLED_OPERATION_PHASES.has(operation.phase))
}

/** This execution host's sign-in for Antigravity chats, run by the host's own server. Every row
 *  for a host shows the same sign-in, a running one included. */
export function AntigravityChatSignInRow(props: {
  owner: RuntimeClientTarget
  label: string
  description: string
  disabled: boolean
}): React.JSX.Element {
  const { owner, label } = props
  const environmentId = owner.kind === 'environment' ? owner.environmentId : null
  useEffect(
    () =>
      observeAntigravityChatSignIn(
        environmentId === null ? { kind: 'local' } : { kind: 'environment', environmentId }
      ),
    [environmentId]
  )
  const read = (): ReturnType<typeof readAntigravityChatSignIn> => readAntigravityChatSignIn(owner)
  const { flow, saved, openFailed, ...view } = useSyncExternalStore(
    subscribeAntigravityChatSignIns,
    read,
    read
  )
  const copy = useClipboardTextCopyFeedback(flow?.url ?? '')
  const failed = translate('accounts.antigravity.chatFailed', 'Sign-in failed. Try again.')
  const error = view.error === null ? null : view.error || failed
  const copyLabel = translate('accounts.antigravity.chatCopyLink', 'Copy sign-in link')
  const copyFailed = translate('accounts.antigravity.chatCopyFailed', 'Could not copy the link.')
  const alert =
    error ??
    (flow?.phase === 'failed' ? (flow.error ?? failed) : null) ??
    (copy.status === 'failed' ? copyFailed : null)
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-medium">
          {translate('accounts.antigravity.chatTitle', 'Antigravity chats')}
        </p>
        <p className="text-xs text-muted-foreground">{props.description}</p>
        <p role="status" className="text-xs text-muted-foreground">
          {chatSignInLine(flow, saved, openFailed, label)}
        </p>
        {alert && (
          <p role="alert" className="text-xs text-destructive">
            {alert}
          </p>
        )}
      </div>
      {running(flow) ? (
        <div className="flex shrink-0 items-center gap-2">
          {flow.url && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={copyLabel}
                  onClick={() => void copy.copyText()}
                >
                  {copy.status === 'copied' ? <Check /> : <Copy />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copyLabel}</TooltipContent>
            </Tooltip>
          )}
          <Button size="xs" variant="ghost" onClick={() => void cancelAntigravityChatSignIn(owner)}>
            {translate('accounts.antigravity.chatCancel', 'Cancel')}
          </Button>
        </div>
      ) : (
        <Button
          size="xs"
          variant="outline"
          disabled={props.disabled}
          onClick={() => void startAntigravityChatSignIn(owner)}
        >
          {signInButtonLabel(flow, saved, error)}
        </Button>
      )}
    </div>
  )
}
