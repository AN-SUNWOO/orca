// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { AntigravityChatSignInRow } from './AntigravityChatSignInRow'
import { TooltipProvider } from '../ui/tooltip'

const url = 'https://accounts.google.com/o/oauth2/v2/auth?state=s'
// The second waiting answer is a 25 s poll that ended with no change.
const replies = [
  { flowId: 'f' },
  ...['waiting', 'waiting', 'signedIn'].map((phase) => ({ phase, url }))
]
vi.mock('@/runtime/runtime-antigravity-accounts-client', () => ({
  callAntigravityChatSignIn: async () => replies.shift()
}))

it('opens the link once across polls and refreshes the list when signed in', async () => {
  const openUrl = vi.fn(async () => undefined)
  Object.assign(window, { api: { shell: { openUrl } } })
  const onSettled = vi.fn()
  const row = (
    <AntigravityChatSignInRow owner={{ kind: 'local' }} label="" saved onSettled={onSettled} />
  )
  render(<TooltipProvider>{row}</TooltipProvider>)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByText('Signed in.')
  expect(openUrl).toHaveBeenCalledExactlyOnceWith(url)
  expect(onSettled).toHaveBeenCalledOnce()
})
