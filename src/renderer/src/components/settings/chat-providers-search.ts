import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import type { SettingsSearchEntry } from './settings-search'
import { translateSearchKeyword } from './settings-search-keywords'

export const getChatProvidersSearchEntry = createLocalizedCatalog(
  () =>
    ({
      targetSectionId: 'chat-providers',
      title: translate('settings.chat.providers.title', 'Providers'),
      description: translate(
        'settings.chat.providers.antigravityDescription',
        'Chats use their own Antigravity sign-in, separate from your agy terminal account. Sign in once on this device.'
      ),
      keywords: [
        ...translateSearchKeyword('accounts.antigravity.keyword.antigravity', 'antigravity'),
        ...translateSearchKeyword('accounts.antigravity.keyword.google', 'google'),
        ...translateSearchKeyword('auto.components.settings.accounts.search.a9f3d7b5c8', 'login')
      ]
    }) satisfies SettingsSearchEntry
)
