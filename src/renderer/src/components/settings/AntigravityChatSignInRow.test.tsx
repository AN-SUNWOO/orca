// @vitest-environment happy-dom
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { callAntigravityChatSignIn } from '@/runtime/runtime-antigravity-accounts-client'
import { AntigravityChatSignInRow } from './AntigravityChatSignInRow'
import { TooltipProvider } from '../ui/tooltip'

const url = 'https://accounts.google.com/o/oauth2/v2/auth?state=s'
// The second waiting answer is a 25 s poll that ended with no change.
const replies = [
  { flowId: 'f' },
  ...['waiting', 'waiting', 'signedIn'].map((phase) => ({ phase, url }))
]
let deferredStart: Promise<{ flowId: string }> | null = null
vi.mock('@/runtime/runtime-antigravity-accounts-client', () => ({
  callAntigravityChatSignIn: vi.fn(async (_owner: unknown, operation: string) =>
    operation === 'Start' && deferredStart ? deferredStart : replies.shift()
  )
}))

it('opens the link once across polls and refreshes the list when signed in', async () => {
  const openUrl = vi.fn(async () => undefined)
  Object.assign(window, { api: { shell: { openUrl } } })
  const onSettled = vi.fn()
  const row = (
    <AntigravityChatSignInRow
      owner={{ kind: 'local' }}
      label=""
      description=""
      saved={false}
      disabled={false}
      onSettled={onSettled}
    />
  )
  const view = render(<TooltipProvider>{row}</TooltipProvider>)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByText('Signed in.')
  expect(screen.getByRole('button', { name: 'Change account' })).toBeTruthy()
  expect(openUrl).toHaveBeenCalledExactlyOnceWith(url)
  expect(onSettled).toHaveBeenCalledOnce()
  view.unmount()
})

it('does not follow a Start response after the row unmounts', async () => {
  vi.mocked(callAntigravityChatSignIn).mockClear()
  const start = Promise.withResolvers<{ flowId: string }>()
  deferredStart = start.promise
  replies.push({ phase: 'waiting', url }, { phase: 'cancelled', url })
  const openUrl = vi.fn(async () => undefined)
  Object.assign(window, { api: { shell: { openUrl } } })
  const onSettled = vi.fn()
  const view = render(
    <TooltipProvider>
      <AntigravityChatSignInRow
        owner={{ kind: 'local' }}
        label=""
        description=""
        saved={false}
        disabled={false}
        onSettled={onSettled}
      />
    </TooltipProvider>
  )
  await userEvent.click(view.getByRole('button', { name: 'Sign in' }))
  view.unmount()
  await act(async () => start.resolve({ flowId: 'late' }))
  expect(callAntigravityChatSignIn).toHaveBeenCalledExactlyOnceWith({ kind: 'local' }, 'Start')
  expect(openUrl).not.toHaveBeenCalled()
  expect(onSettled).not.toHaveBeenCalled()
  deferredStart = null
})
