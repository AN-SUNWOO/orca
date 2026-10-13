import { useCallback, useMemo, useSyncExternalStore } from 'react'
import {
  AI_VAULT_AGENTS,
  type AiVaultAgent,
  type AiVaultGroup,
  type AiVaultSearchSort,
  type AiVaultSort
} from '../../../../shared/ai-vault-types'
import {
  createDefaultAiVaultViewOptions,
  enabledAiVaultAgents,
  readAiVaultViewOptions,
  writeAiVaultViewOptions,
  type AiVaultViewOptions
} from './ai-vault-view-options-persistence'
import type { AiVaultSessionLimit } from './ai-vault-session-limit'

type AiVaultViewOptionsUpdate = (current: AiVaultViewOptions) => AiVaultViewOptions

// Why one copy: the sidebar and the /resume dialog can both be mounted, and each writing its own
// copy would undo the other's change. It is read again once no panel is mounted.
let mountedOptions: AiVaultViewOptions | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      mountedOptions = null
    }
  }
}

function getOptions(): AiVaultViewOptions {
  mountedOptions ??= readAiVaultViewOptions()
  return mountedOptions
}

function updateOptions(update: AiVaultViewOptionsUpdate): void {
  const current = getOptions()
  const candidate = update(current)
  if (candidate === current) {
    return
  }
  // Why: setters map valid state to valid state, so persist the candidate directly.
  // Re-normalizing here would re-allocate disabledAgents on every sort/group change and
  // needlessly recompute the session filter; writeAiVaultViewOptions still normalizes what it stores.
  mountedOptions = candidate
  writeAiVaultViewOptions(candidate)
  for (const listener of listeners) {
    listener()
  }
}

export function usePersistedAiVaultViewOptions(): {
  agents: AiVaultAgent[]
  sort: AiVaultSort
  searchSort: AiVaultSearchSort
  group: AiVaultGroup
  hideEmptySessions: boolean
  sessionLimit: AiVaultSessionLimit
  setSort: (sort: AiVaultSort) => void
  setSearchSort: (sort: AiVaultSearchSort) => void
  setGroup: (group: AiVaultGroup) => void
  setHideEmptySessions: (hide: boolean) => void
  setSessionLimit: (limit: AiVaultSessionLimit) => void
  setAgentEnabled: (agent: AiVaultAgent, enabled: boolean) => void
  setAllAgentsEnabled: (enabled: boolean) => void
  resetViewOptions: () => void
} {
  // Why: menu actions may batch before a render, so every write builds on the module copy,
  // which the preceding action already updated, instead of the last rendered options.
  const options = useSyncExternalStore(subscribe, getOptions)

  const setSort = useCallback(
    (sort: AiVaultSort) =>
      updateOptions((current) => (current.sort === sort ? current : { ...current, sort })),
    []
  )
  const setSearchSort = useCallback(
    (searchSort: AiVaultSearchSort) =>
      updateOptions((current) =>
        current.searchSort === searchSort ? current : { ...current, searchSort }
      ),
    []
  )
  const setGroup = useCallback(
    (group: AiVaultGroup) =>
      updateOptions((current) => (current.group === group ? current : { ...current, group })),
    []
  )
  const setHideEmptySessions = useCallback(
    (hideEmptySessions: boolean) =>
      updateOptions((current) =>
        current.hideEmptySessions === hideEmptySessions
          ? current
          : { ...current, hideEmptySessions }
      ),
    []
  )
  const setSessionLimit = useCallback(
    (sessionLimit: AiVaultSessionLimit) =>
      updateOptions((current) =>
        current.sessionLimit === sessionLimit ? current : { ...current, sessionLimit }
      ),
    []
  )
  const setAgentEnabled = useCallback((agent: AiVaultAgent, enabled: boolean) => {
    updateOptions((current) => {
      const isDisabled = current.disabledAgents.includes(agent)
      if (enabled === !isDisabled) {
        return current
      }
      // Why: allow zero enabled agents so Clear + re-check one agent is a two-step filter.
      const disabledAgents = enabled
        ? current.disabledAgents.filter((entry) => entry !== agent)
        : [...current.disabledAgents, agent]
      return { ...current, disabledAgents }
    })
  }, [])
  const setAllAgentsEnabled = useCallback((enabled: boolean) => {
    updateOptions((current) => {
      const disabledAgents = enabled ? [] : [...AI_VAULT_AGENTS]
      if (
        disabledAgents.length === current.disabledAgents.length &&
        disabledAgents.every((agent) => current.disabledAgents.includes(agent))
      ) {
        return current
      }
      return { ...current, disabledAgents }
    })
  }, [])
  const resetViewOptions = useCallback(
    () => updateOptions(() => createDefaultAiVaultViewOptions()),
    []
  )

  const agents = useMemo(
    () => enabledAiVaultAgents(options.disabledAgents),
    [options.disabledAgents]
  )
  return {
    agents,
    sort: options.sort,
    searchSort: options.searchSort,
    group: options.group,
    hideEmptySessions: options.hideEmptySessions,
    sessionLimit: options.sessionLimit,
    setSort,
    setSearchSort,
    setGroup,
    setHideEmptySessions,
    setSessionLimit,
    setAgentEnabled,
    setAllAgentsEnabled,
    resetViewOptions
  }
}
