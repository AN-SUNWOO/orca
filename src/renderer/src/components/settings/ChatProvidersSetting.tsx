import { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { callAntigravityAccounts } from '@/runtime/runtime-antigravity-accounts-client'
import { useManagedRuntimeInstall } from '@/runtime/use-managed-runtime-install'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { ManagedRuntimeInstallRow } from '../managed-runtime/ManagedRuntimeInstallRow'
import { AntigravityChatSignInRow, antigravityChatSignInBlocked } from './AntigravityChatSignInRow'
import { getHostRuntimeLabel, getRuntimeSentenceLabel } from './accounts-pane-runtime'
import { getChatProvidersSearchEntry } from './chat-providers-search'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSubsectionHeader } from './SettingsFormControls'

// Chats on this screen run on this machine, so their runtime and sign-in are this machine's.
const CHAT_HOST: RuntimeClientTarget = { kind: 'local' }

export function ChatProvidersSetting({
  forceVisible
}: {
  forceVisible: boolean
}): React.JSX.Element | null {
  const antigravity = useManagedRuntimeInstall(CHAT_HOST, 'antigravity', true)
  const active = antigravity.kind === 'active'
  const [saved, setSaved] = useState(false)
  const [listRequest, setListRequest] = useState(0)
  useEffect(() => {
    if (!active) {
      return
    }
    let cancelled = false
    // A failed read leaves the row offering sign-in, which is still correct to act on.
    void callAntigravityAccounts(CHAT_HOST, { runtime: 'host' }, 'List').then(
      (state) => {
        if (!cancelled) {
          setSaved(state.chatSignIn?.saved === true)
        }
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [active, listRequest])
  if (antigravity.kind !== 'active') {
    return null
  }
  const entry = getChatProvidersSearchEntry()
  return (
    <SearchableSetting
      {...entry}
      id="chat-providers"
      forceVisible={forceVisible}
      className="max-w-none space-y-3"
    >
      <SettingsSubsectionHeader title={entry.title} description={entry.description} />
      <ManagedRuntimeInstallRow
        observation={antigravity}
        agentLabel={translate('accounts.antigravity.title', 'Antigravity')}
        surface="settings"
      />
      <AntigravityChatSignInRow
        owner={CHAT_HOST}
        label={getRuntimeSentenceLabel({ runtime: 'host', label: getHostRuntimeLabel() })}
        description={translate(
          'settings.chat.providers.antigravitySignIn',
          'Chats use their own Antigravity sign-in, separate from your agy terminal account. Sign in once on this device.'
        )}
        saved={saved}
        disabled={antigravityChatSignInBlocked(antigravity)}
        onSettled={() => setListRequest((request) => request + 1)}
      />
    </SearchableSetting>
  )
}
