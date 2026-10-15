// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
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

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveSubject.mockReturnValue({ workspaceId: 'worktree-1', kind: 'chat' })
  mocks.resolveSwitch.mockReturnValue({ action: 'resume-in-new-cli', worktreeId: 'worktree-1' })
})

it.each([
  { groupSurvives: true, launches: 1 },
  { groupSurvives: false, launches: 0 }
])('uses the clicked pane during history lookup (survives=$groupSurvives)', async ({
  groupSurvives,
  launches
}) => {
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
      expect(options.isCancelled()).toBe(!groupSurvives)
      return { id: 'saved-row' }
    }
  )
  render(
    <TooltipProvider>
      <NativeChatResumeInCliButton
        tabId="chat-tab"
        worktreeId="worktree-1"
        groupId="chat-group"
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

  await waitFor(() => expect(button).not.toBeDisabled())
  await waitFor(() => expect(mocks.resume).toHaveBeenCalledTimes(launches))
  if (groupSurvives) {
    expect(mocks.resume).toHaveBeenCalledWith(
      { id: 'saved-row' },
      'worktree-1',
      'chat-group'
    )
  }
})
