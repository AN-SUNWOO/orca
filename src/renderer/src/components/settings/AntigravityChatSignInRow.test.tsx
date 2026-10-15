// @vitest-environment happy-dom
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import {
  callAntigravityAccounts,
  callAntigravityChatSignIn
} from '@/runtime/runtime-antigravity-accounts-client'
import { AntigravityChatSignInRow } from './AntigravityChatSignInRow'
import { TooltipProvider } from '../ui/tooltip'

const url = 'https://accounts.google.com/o/oauth2/v2/auth?state=s'
// The second waiting answer is a 25 s poll that ended with no change.
const replies = [
  { flowId: 'f' },
  ...['waiting', 'waiting', 'signedIn'].map((phase) => ({ flowId: 'f', phase, url }))
]
let deferredStart: Promise<{ flowId: string }> | null = null
const host = vi.hoisted(
  (): { chatSignIn: { saved: boolean; signingIn: boolean; flowId?: string } } => ({
    chatSignIn: { saved: false, signingIn: false }
  })
)
vi.mock('@/runtime/runtime-antigravity-accounts-client', () => ({
  callAntigravityAccounts: vi.fn(async () => ({ chatSignIn: host.chatSignIn })),
  // An empty queue is a Link poll still waiting on the host.
  callAntigravityChatSignIn: vi.fn(async (_owner: unknown, operation: string) =>
    operation === 'Start' && deferredStart
      ? deferredStart
      : (replies.shift() ?? new Promise(() => {}))
  )
}))

it('opens the link once across polls and refreshes the list when signed in', async () => {
  const openUrl = vi.fn(async () => undefined)
  Object.assign(window, { api: { shell: { openUrl } } })
  const row = (
    <AntigravityChatSignInRow owner={{ kind: 'local' }} label="" description="" disabled={false} />
  )
  const view = render(<TooltipProvider>{row}</TooltipProvider>)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByText('Signed in.')
  expect(screen.getByRole('button', { name: 'Change account' })).toBeTruthy()
  expect(openUrl).toHaveBeenCalledExactlyOnceWith(url)
  expect(callAntigravityAccounts).toHaveBeenCalledTimes(2)
  view.unmount()
})

it('does not follow a Start response after the row unmounts', async () => {
  vi.mocked(callAntigravityChatSignIn).mockClear()
  const start = Promise.withResolvers<{ flowId: string }>()
  deferredStart = start.promise
  replies.push(
    { flowId: 'late', phase: 'waiting', url },
    { flowId: 'late', phase: 'cancelled', url }
  )
  const openUrl = vi.fn(async () => undefined)
  Object.assign(window, { api: { shell: { openUrl } } })
  const owner = { kind: 'environment', environmentId: 'unmounted' } as const
  const view = render(
    <TooltipProvider>
      <AntigravityChatSignInRow owner={owner} label="" description="" disabled={false} />
    </TooltipProvider>
  )
  await userEvent.click(view.getByRole('button', { name: 'Sign in' }))
  view.unmount()
  await act(async () => start.resolve({ flowId: 'late' }))
  expect(callAntigravityChatSignIn).toHaveBeenCalledExactlyOnceWith(owner, 'Start')
  expect(openUrl).not.toHaveBeenCalled()
  deferredStart = null
})

it('picks up a sign-in already running on the host, so it can be cancelled from here', async () => {
  replies.splice(0, replies.length, { flowId: 'running', phase: 'waiting', url })
  host.chatSignIn = { saved: false, signingIn: true, flowId: 'running' }
  const openUrl = vi.fn(async () => undefined)
  Object.assign(window, { api: { shell: { openUrl } } })
  const owner = { kind: 'environment', environmentId: 'adopted' } as const
  render(
    <TooltipProvider>
      <AntigravityChatSignInRow owner={owner} label="" description="" disabled={false} />
    </TooltipProvider>
  )
  await screen.findByText('Finish signing in in your browser.')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(callAntigravityChatSignIn).toHaveBeenCalledWith(owner, 'Cancel', { flowId: 'running' })
  expect(openUrl).not.toHaveBeenCalled()
})
