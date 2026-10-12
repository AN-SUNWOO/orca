// @vitest-environment happy-dom
import { act } from 'react'
import { expect, it, vi, type Mock } from 'vitest'
import { NativeChatResumeOnRestartModal } from './NativeChatResumeOnRestartModal'
import { NativeChatResumeStatusSegment } from './status-bar/NativeChatResumeStatusSegment'
import {
  createResumeModalFixture,
  type RestartRpc,
  type ResumeStatusStream
} from './native-chat-resume-modal.test-support'
import { lastToastShow } from './native-chat-resume-toast.test-support'
import { useAppStore } from '../store'

const rpc: Mock<RestartRpc> = vi.hoisted(() => vi.fn<RestartRpc>())
const statusStream: ResumeStatusStream = vi.hoisted(() => ({
  emit: (_event: Parameters<ResumeStatusStream['emit']>[0]) => {},
  snapshot: new Map()
}))
vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: rpc,
  subscribeStructuredAgentSessionStatus: async (
    _target: unknown,
    emit: ResumeStatusStream['emit']
  ) => {
    statusStream.emit = emit
    emit({ type: 'snapshot', sessions: [...statusStream.snapshot.values()] })
    return { unsubscribe: () => {} }
  }
}))
vi.mock('sonner', () => ({ toast: vi.fn() }))

const { mount, button, fakeHost } = createResumeModalFixture(rpc, statusStream)
const dialog = () => document.querySelector('[role="dialog"]')
const tree = () => document.querySelector('[role="tree"]')

async function mountSurfaces(): Promise<void> {
  await mount(
    <>
      <NativeChatResumeOnRestartModal />
      <NativeChatResumeStatusSegment iconOnly={false} />
    </>
  )
}

it('shows a finished resume as a result, in the past tense, once nothing is left to choose', async () => {
  fakeHost()
  await mountSurfaces()
  await act(async () => button('Resume 2 chats').click())
  await act(async () => lastToastShow()?.())
  expect(dialog()?.textContent).toContain('Resumed 2 of 2 chats')
  expect(dialog()?.textContent).toContain(
    'Orca restored each one where it stopped, with its full context'
  )
  expect(dialog()?.textContent).not.toContain('Resuming restores')
  expect(tree()?.querySelectorAll('[role="checkbox"]')).toHaveLength(0)
  expect(tree()?.textContent).not.toContain('Select all')
  expect(dialog()?.textContent).not.toContain("Don't ask again")
  // The user pressed Resume, so nothing says it happened on its own.
  expect(dialog()?.textContent).not.toContain('automatically')
})

it('says a launch resumed on its own and links to the setting', async () => {
  const openSettingsPage = vi.fn()
  const openSettingsTarget = vi.fn()
  useAppStore.setState((state) => ({
    settings: { ...state.settings!, nativeChatResumeWorkOnRestart: true },
    openSettingsPage,
    openSettingsTarget
  }))
  fakeHost()
  await mountSurfaces()
  expect(dialog()).toBeNull()
  await act(async () => lastToastShow()?.())
  expect(dialog()?.textContent).toContain('Resumed automatically after the restart.')
  expect(dialog()?.textContent).not.toContain("Don't ask again")

  await act(async () => button('Change in Settings').click())
  expect(openSettingsPage).toHaveBeenCalledOnce()
  expect(openSettingsTarget).toHaveBeenCalledWith({
    pane: 'experimental',
    repoId: null,
    sectionId: 'native-chat-resume-on-restart'
  })
  // The dialog gets out of the way of the page it opened.
  expect(dialog()).toBeNull()
})

it('keeps the checkboxes while a chat can still be chosen, whichever tab is shown', async () => {
  fakeHost({}, (sessionId) => (sessionId === 'b' ? 'refused' : 'continued'))
  await mountSurfaces()
  await act(async () => button('Resume 2 chats').click())
  await act(async () => button('1 chat failed to resume').click())
  expect(dialog()?.textContent).toContain('The ones Orca resumed were restored')
  expect(tree()?.textContent).toContain('Select all')
  await act(async () => button('Resumed1').click())
  // Filtering to rows that all show a status must not drop the column under the user.
  expect(tree()?.textContent).toContain('Select all')
})
