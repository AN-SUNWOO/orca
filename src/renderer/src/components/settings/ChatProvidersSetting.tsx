import { translate } from '@/i18n/i18n'
import { useManagedRuntimeInstall } from '@/runtime/use-managed-runtime-install'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { ManagedRuntimeInstallRow } from '../managed-runtime/ManagedRuntimeInstallRow'
import { getChatProvidersSearchEntry } from './chat-providers-search'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSubsectionHeader } from './SettingsFormControls'

// Chats on this screen run on this machine, so their runtime is this machine's.
const CHAT_HOST: RuntimeClientTarget = { kind: 'local' }

export function ChatProvidersSetting({
  forceVisible
}: {
  forceVisible: boolean
}): React.JSX.Element | null {
  const antigravity = useManagedRuntimeInstall(CHAT_HOST, 'antigravity', true)
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
    </SearchableSetting>
  )
}
