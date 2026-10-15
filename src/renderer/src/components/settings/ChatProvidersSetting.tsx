import { useEffect, useState } from 'react'
import { callAntigravityAccounts } from '@/runtime/runtime-antigravity-accounts-client'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import {
  AntigravityChatSignInRow,
  hostOffersAntigravityChatSignIn
} from './AntigravityChatSignInRow'
import { getHostRuntimeLabel, getRuntimeSentenceLabel } from './accounts-pane-runtime'
import { getChatProvidersSearchEntry } from './chat-providers-search'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSubsectionHeader } from './SettingsFormControls'

// Chats on this screen run on this machine, so their sign-in is this machine's.
const CHAT_HOST: RuntimeClientTarget = { kind: 'local' }

export function ChatProvidersSetting({
  forceVisible
}: {
  forceVisible: boolean
}): React.JSX.Element | null {
  const available = hostOffersAntigravityChatSignIn(CHAT_HOST, 'host')
  const [saved, setSaved] = useState(false)
  const [listRequest, setListRequest] = useState(0)
  useEffect(() => {
    if (!available) {
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
  }, [available, listRequest])
  if (!available) {
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
      <SettingsSubsectionHeader title={entry.title} />
      <AntigravityChatSignInRow
        owner={CHAT_HOST}
        label={getRuntimeSentenceLabel({ runtime: 'host', label: getHostRuntimeLabel() })}
        description={entry.description}
        saved={saved}
        onSettled={() => setListRequest((request) => request + 1)}
      />
    </SearchableSetting>
  )
}
