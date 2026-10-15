import { describe, expect, it, vi } from 'vitest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { updateSettings, type SettingsMutationOperations } from './settings-update'

// Launch paths read this setting raw, so every writer must store it trimmed.
describe('updateSettings terminalDefaultShell', () => {
  it('stores a padded write trimmed and a whitespace-only write as the system shell', () => {
    const operations: SettingsMutationOperations = {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the fields updateSettings reads for this setting.
      state: { settings: { terminalDefaultShell: '' }, repos: [] } as unknown as PersistedState,
      bumpLocalWorktreeScanGeneration: vi.fn(),
      removeRetainedBlob: vi.fn(),
      scheduleSave: vi.fn(),
      notifySettingsChanged: vi.fn()
    }

    expect(
      updateSettings(operations, { terminalDefaultShell: '/bin/zsh ' }).terminalDefaultShell
    ).toBe('/bin/zsh')
    expect(updateSettings(operations, { terminalDefaultShell: '  ' }).terminalDefaultShell).toBe('')
  })
})
