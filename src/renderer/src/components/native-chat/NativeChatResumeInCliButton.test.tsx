// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  lookup: vi.fn(),
  resolveSubject: vi.fn(),
  resolveSwitch: vi.fn(),
  resume: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@/store', () => ({ useAppStore: { getState: mocks.getState } }))
vi.mock('@/lib/browser-uuid', () => ({ createBrowserUuid: () => 'request-1' }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('../tab-bar/use-tab-session-launch-actions', () => ({
  useTabSessionLaunchActions: () => ({ handleResumeInNewCli: mocks.resume })
}))
vi.mock('../tab-bar/tab-session-history-switch', () => ({
  lookupTabSessionHistoryRow: mocks.lookup,
  resolveTabSessionHistorySubject: mocks.resolveSubject,
  resolveTabSessionSwitch: mocks.resolveSwitch
}))

import { NativeChatResumeInCliButton } from './NativeChatResumeInCliButton'

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveSubject.mockReturnValue({ workspaceId: 'worktree-1', kind: 'chat' })
  mocks.resolveSwitch.mockReturnValue({ action: 'resume-in-new-cli', worktreeId: 'worktree-1' })
})

it.each([true, false])('finishes Resume after source chat closes (pane survives=%s)', async (
  groupSurvives
) => {
  const state = {
    groupsByWorktree: { 'worktree-1': [{ id: 'chat-group' }] },
    unifiedTabsByWorktree: { 'worktree-1': [{ id: 'chat-tab' }, { id: 'sibling-tab' }] }
  }
  mocks.getState.mockReturnValue(state)
  let releaseHistory: () => void = () => undefined
  const history = new Promise<void>((resolve) => {
    releaseHistory = resolve
  })
  mocks.lookup.mockImplementation(
    async (_subject: unknown, _list: unknown, options: { isCancelled: () => boolean }) => {
      await history
      expect(options.isCancelled()).toBe(false)
      return { id: 'saved-row' }
    }
  )
  render(
    <TooltipProvider>
      <NativeChatResumeInCliButton
        tabId="chat-tab"
        worktreeId="worktree-1"
        nativeChat={{ sessionId: 'chat-1', agent: 'claude' }}
      />
    </TooltipProvider>
  )
  const button = screen.getByRole('button', { name: 'Resume in New CLI' })
  fireEvent.click(button)
  await waitFor(() => expect(mocks.lookup).toHaveBeenCalledOnce())
  state.unifiedTabsByWorktree['worktree-1'] = [{ id: 'sibling-tab' }]
  if (!groupSurvives) {
    state.groupsByWorktree['worktree-1'] = []
  }
  releaseHistory()

  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
  await waitFor(() => expect(mocks.resume).toHaveBeenCalledOnce())
  expect(mocks.resume).toHaveBeenCalledWith(
    { id: 'saved-row' },
    'worktree-1'
  )
})
