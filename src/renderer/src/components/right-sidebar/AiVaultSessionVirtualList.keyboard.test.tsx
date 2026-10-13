// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react'
import { createRef, type KeyboardEvent } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import type { AiVaultSessionListGroup } from './ai-vault-session-filters'
import type { AiVaultSessionListKeyboard } from './use-ai-vault-session-keyboard-navigation'

const VIEWPORT_PX = 600
const ROW_PX = 98

// The rich row is covered by its own tests; here only which row is selected matters.
vi.mock('./AiVaultSessionRow', () => ({
  VaultSessionRow: (props: { session: AiVaultSession }) => <div>{props.session.title}</div>
}))

import { AiVaultSessionVirtualList } from './AiVaultSessionVirtualList'

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function session(n: number): AiVaultSession {
  return {
    id: `local:claude:s-${n}`,
    executionHostId: 'local',
    agent: 'claude',
    sessionId: `s-${n}`,
    title: `Session ${n}`,
    cwd: '/repo',
    branch: null,
    model: null,
    filePath: `/tmp/s-${n}.jsonl`,
    codexHome: null,
    createdAt: null,
    updatedAt: null,
    modifiedAt: '2026-09-17T00:00:00.000Z',
    messageCount: 2,
    totalTokens: 0,
    previewMessages: [{ role: 'user', text: 'Fix it', timestamp: null }],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: `claude --resume s-${n}`,
    subagent: null
  }
}

const sessions = Array.from({ length: 30 }, (_, n) => session(n))

function renderList(
  options: {
    groups?: AiVaultSessionListGroup[]
    collapsedGroups?: ReadonlySet<string>
    openSessionIds?: ReadonlySet<string>
    eligible?: (session: AiVaultSession) => boolean
  } = {}
) {
  const keyboard = createRef<AiVaultSessionListKeyboard>()
  const calls = {
    onJumpToOriginalPane: vi.fn(),
    onResumeInNewChat: vi.fn(),
    onResume: vi.fn()
  }
  const groups = options.groups ?? [{ key: 'all', label: null, sessions }]
  const list = (query: string) => (
    <AiVaultSessionVirtualList
      query={query}
      groups={groups}
      collapsedGroups={options.collapsedGroups ?? new Set()}
      loading={false}
      sessionsCount={sessions.length}
      filteredSessionsCount={sessions.length}
      noAgentsSelected={false}
      error={null}
      vaultScope="workspace"
      buildResumeStartup={() => ({ command: '' })}
      getOriginalPaneTarget={() => null}
      isStructuredSessionOpen={(s) => options.openSessionIds?.has(s.id) ?? false}
      getSessionLiveState={() => null}
      getWorktreeInfo={() => null}
      getSessionResumeState={() => ({
        blocked: false,
        worktreeId: 'wt-1',
        usesSessionWorktree: true
      })}
      getSessionResumeActions={() => ({
        worktree: { worktreeId: null, disabled: true },
        newTab: { worktreeId: 'wt-1', disabled: false }
      })}
      getSessionResumeInChat={(s) =>
        (options.eligible?.(s) ?? true)
          ? { available: true, workspaceId: `own-${s.sessionId}` }
          : { available: false, reason: 'remote' }
      }
      onToggleGroup={vi.fn()}
      onJumpToOriginalPane={calls.onJumpToOriginalPane}
      onJumpToWorktree={vi.fn()}
      onResume={calls.onResume}
      onContinueInNewSession={vi.fn()}
      onResumeInNewChat={calls.onResumeInNewChat}
      onResumeInNewCli={vi.fn()}
      onCopyResume={vi.fn()}
      onCopyId={vi.fn()}
      onCopyPath={vi.fn()}
      onOpenLog={vi.fn()}
      onRevealLog={vi.fn()}
      onOpenCwd={vi.fn()}
      onRequestDelete={vi.fn()}
      keyboardRef={keyboard}
    />
  )
  const view = render(list(''))
  const press = (key: string, repeat = false) => {
    const event = { key, repeat, preventDefault: vi.fn() }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads only key, modifiers, repeat and preventDefault.
    act(() => keyboard.current?.handleKeyDown(event as unknown as KeyboardEvent<HTMLElement>))
    return event
  }
  return { calls, press, search: (query: string) => view.rerender(list(query)) }
}

function selectedTitle(): string | null {
  return document.querySelector('[data-selected="true"]')?.textContent ?? null
}

beforeEach(() => {
  // Why: happy-dom has no layout; give the virtualizer a bounded viewport and fixed rows.
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement
  ) {
    return this.classList.contains('overflow-y-auto') ? VIEWPORT_PX : ROW_PX
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const isScroller = this.classList.contains('overflow-y-auto')
    return new DOMRect(0, 0, 400, isScroller ? VIEWPORT_PX : ROW_PX)
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Session History keyboard selection', () => {
  it('moves over sessions only, clamped, and a listed-twice session does not trap it', () => {
    const { press } = renderList({
      groups: [
        { key: 'a', label: 'Alpha', sessions: [sessions[0], sessions[1]] },
        { key: 'b', label: 'Beta', sessions: sessions.slice(2, 4) },
        { key: 'c', label: 'Gamma', sessions: [sessions[1], sessions[4]] }
      ],
      collapsedGroups: new Set(['b'])
    })
    expect(selectedTitle()).toBe('Session 0')
    expect(press('ArrowUp').preventDefault).toHaveBeenCalled()
    expect(selectedTitle()).toBe('Session 0')
    press('ArrowDown')
    press('ArrowDown')
    press('ArrowDown')
    expect(selectedTitle()).toBe('Session 4')
  })

  it('starts again at the top match when the search text changes', () => {
    const { press, search } = renderList()
    press('ArrowDown')
    press('ArrowDown')
    search('fix')
    expect(selectedTitle()).toBe('Session 0')
    search('')
    expect(selectedTitle()).toBe('Session 0')
  })

  it("Enter switches to an open session, else opens it as a chat, else runs the row's ▶", () => {
    const { press, calls } = renderList({
      openSessionIds: new Set([sessions[0].id]),
      eligible: (s) => s.id !== sessions[2].id
    })
    press('Enter')
    press('Enter', true)
    press('ArrowDown')
    press('Enter')
    press('ArrowDown')
    press('Enter')
    expect(calls.onJumpToOriginalPane).toHaveBeenCalledExactlyOnceWith(sessions[0])
    expect(calls.onResumeInNewChat).toHaveBeenCalledExactlyOnceWith(sessions[1], 'own-s-1')
    expect(calls.onResume).toHaveBeenCalledExactlyOnceWith(sessions[2], 'wt-1')
  })
})
