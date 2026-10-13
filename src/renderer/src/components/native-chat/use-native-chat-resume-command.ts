import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { SlashCommandSuggestion } from '../../../../shared/native-chat-slash-commands'
import { selectAiVaultPanelWorkspace } from '../right-sidebar/ai-vault-panel-workspace'
import { openAgentSessionHistoryModal } from '../right-sidebar/agent-session-history-modal'
import type { ComposerAutocomplete, NativeChatPickerItem } from './native-chat-composer-state'
import { findNativeChatTabOwnerWorktreeId } from './native-chat-file-link'
import type { NativeChatComposerInput } from './native-chat-composer-input'

const RESUME = 'resume'

/** A structured chat's catalog with Orca's `/resume`, in place of an agent command of that name. */
export function withNativeChatResumeCommand(
  commands: readonly SlashCommandSuggestion[]
): SlashCommandSuggestion[] {
  const resume: SlashCommandSuggestion = {
    name: RESUME,
    description: translate(
      'components.native-chat.resumeCommand.description',
      'Open Agent Session History'
    ),
    argumentHint: translate('components.native-chat.resumeCommand.argumentHint', '[search]'),
    orcaOwned: true
  }
  const at = commands.findIndex(({ name }) => name === RESUME)
  return at === -1
    ? [...commands, resume]
    : [...commands.slice(0, at), resume, ...commands.slice(at)]
}

/** The search a `/resume` draft carries, read the way the chat host reads a command; else null. */
export function parseNativeChatResumeDraft(draft: string): string | null {
  const firstToken = draft.split(/\s/, 1)[0] ?? ''
  if (firstToken.toLowerCase() !== `/${RESUME}`) {
    return null
  }
  return draft.slice(firstToken.length).replace(/\s+/g, ' ').trim()
}

export type NativeChatResumeCommand = {
  /** Opens Session History for a `/resume` draft; false means the draft is not Orca's. */
  consume: (draft: string) => boolean
  /** Choosing the draft-leading Orca row runs it; mid-prompt it stays an ordinary completion. */
  interceptPick: <TItem extends NativeChatPickerItem>(
    pick: (item: TItem) => void,
    autocomplete: ComposerAutocomplete
  ) => (item: TItem) => void
}

/** In a structured chat, `/resume [search]` opens its Session History and never reaches the agent. */
export function useNativeChatResumeCommand(args: {
  structured: boolean
  terminalTabId: string
  structuredWorktreeId: string | undefined
  /** A skill row the user picked keeps going to the agent, even one named `resume`. */
  isPickedSkill: (draft: string) => boolean
  clearSkillOrigin: () => void
  textareaRef: RefObject<NativeChatComposerInput | null>
  setDraft: (value: string) => void
  setCaret: Dispatch<SetStateAction<number>>
  setActiveSuggestion: Dispatch<SetStateAction<number>>
  setNotice: (notice: string | null) => void
}): NativeChatResumeCommand {
  const { structured, terminalTabId, structuredWorktreeId, isPickedSkill, clearSkillOrigin } = args
  const { textareaRef, setDraft, setCaret, setActiveSuggestion, setNotice } = args

  const open = useCallback(
    (search: string): void => {
      const state = useAppStore.getState()
      const worktreeId =
        structuredWorktreeId ?? findNativeChatTabOwnerWorktreeId(state, terminalTabId)
      // The chat is on screen, so its workspace is the active one whenever the ids agree.
      const executionHostId =
        worktreeId === state.activeWorktreeId
          ? (state.activeWorkspaceExecutionHostId ?? undefined)
          : undefined
      const workspace = worktreeId
        ? { worktreeId, ...(executionHostId ? { executionHostId } : {}) }
        : null
      // Refuse rather than let "Workspace" silently mean another workspace's history.
      if (!workspace || !selectAiVaultPanelWorkspace(state, workspace).worktree) {
        setNotice(
          translate(
            'components.native-chat.resumeCommand.workspaceUnavailable',
            "This chat's workspace isn't loaded yet. Try /resume again in a moment."
          )
        )
        return
      }
      // The dialog hands focus back to what had it, and a Send click leaves that on the button.
      textareaRef.current?.focus()
      openAgentSessionHistoryModal({ workspace, initialQuery: search })
      // Attachments stay armed for the next real prompt.
      setDraft('')
      setCaret(0)
      setActiveSuggestion(0)
      setNotice(null)
    },
    [
      setActiveSuggestion,
      setCaret,
      setDraft,
      setNotice,
      structuredWorktreeId,
      terminalTabId,
      textareaRef
    ]
  )

  const consume = useCallback(
    (draft: string): boolean => {
      const search = structured && !isPickedSkill(draft) ? parseNativeChatResumeDraft(draft) : null
      if (search !== null) {
        open(search)
      }
      return search !== null
    },
    [isPickedSkill, open, structured]
  )

  const interceptPick = useCallback(
    <TItem extends NativeChatPickerItem>(
      pick: (item: TItem) => void,
      autocomplete: ComposerAutocomplete
    ) =>
      (item: TItem) => {
        const leading = autocomplete.mode === 'slash' && autocomplete.dispatchable
        // Choosing Orca's own row is explicit, so an earlier skill pick of the same name doesn't count.
        if (leading && item.kind === 'command' && item.orcaOwned) {
          clearSkillOrigin()
          open('')
          return
        }
        pick(item)
      },
    [clearSkillOrigin, open]
  )

  return { consume, interceptPick }
}
