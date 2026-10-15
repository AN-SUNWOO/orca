// @vitest-environment happy-dom
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { AntigravityChatSignInState } from '../../../../shared/antigravity-account-types'
import { callAntigravityChatSignIn } from '@/runtime/runtime-antigravity-accounts-client'
import { AntigravityChatSignInRow } from './AntigravityChatSignInRow'
import { TooltipProvider } from '../ui/tooltip'

const url = 'https://accounts.google.com/o/oauth2/v2/auth?state=s'
type FakeHost = {
  revision: number
  saved: boolean
  flow: AntigravityChatSignInState | null
  start: Promise<{ flowId: string }> | null
  waiters: (() => void)[]
}
// The host's sign-in status, answered by revision as the host does.
const { host, publish } = vi.hoisted(() => {
  const host: FakeHost = { revision: 0, saved: false, flow: null, start: null, waiters: [] }
  const publish = (flow: AntigravityChatSignInState, saved = false): void => {
    Object.assign(host, { revision: host.revision + 1, flow, saved })
    host.waiters.splice(0).forEach((wake) => wake())
  }
  return { host, publish }
})
vi.mock('@/runtime/runtime-antigravity-accounts-client', () => ({
  callAntigravityChatSignIn: vi.fn(
    async (_owner: unknown, action: string, params?: { shown?: number }) => {
      if (action === 'Start') {
        if (host.start) {
          return host.start
        }
        publish({ flowId: 'f', phase: 'starting' })
        return { flowId: 'f' }
      }
      if (action === 'Status' && params?.shown === host.revision) {
        await new Promise<void>((wake) => host.waiters.push(wake))
      }
      return { revision: host.revision, saved: host.saved, flow: host.flow }
    }
  )
}))

function showRow(owner: { kind: 'local' } | { kind: 'environment'; environmentId: string }) {
  return render(
    <TooltipProvider>
      <AntigravityChatSignInRow owner={owner} label="" description="" disabled={false} />
    </TooltipProvider>
  )
}

it('opens the link once across status answers and shows signed in', async () => {
  const openUrl = vi.fn(async () => undefined)
  Object.assign(window, { api: { shell: { openUrl } } })
  const view = showRow({ kind: 'local' })
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await act(async () => publish({ flowId: 'f', phase: 'waiting', url }))
  await screen.findByText('Finish signing in in your browser.')
  await act(async () => publish({ flowId: 'f', phase: 'waiting', url }))
  await act(async () => publish({ flowId: 'f', phase: 'signedIn' }, true))
  await screen.findByText('Signed in.')
  expect(screen.getByRole('button', { name: 'Change account' })).toBeTruthy()
  expect(openUrl).toHaveBeenCalledExactlyOnceWith(url)
  view.unmount()
})

it('opens nothing for a Start the host answers after the row unmounts', async () => {
  const start = Promise.withResolvers<{ flowId: string }>()
  host.start = start.promise
  const openUrl = vi.fn(async () => undefined)
  Object.assign(window, { api: { shell: { openUrl } } })
  const view = showRow({ kind: 'environment', environmentId: 'unmounted' })
  await userEvent.click(view.getByRole('button', { name: 'Sign in' }))
  view.unmount()
  await act(async () => {
    start.resolve({ flowId: 'late' })
    publish({ flowId: 'late', phase: 'waiting', url })
  })
  expect(openUrl).not.toHaveBeenCalled()
  host.start = null
})

it('an idle row shows a sign-in another device starts, and can cancel it', async () => {
  publish({ flowId: 'done', phase: 'cancelled' })
  const openUrl = vi.fn(async () => undefined)
  Object.assign(window, { api: { shell: { openUrl } } })
  const owner = { kind: 'environment', environmentId: 'idle' } as const
  showRow(owner)
  await screen.findByText('Sign-in cancelled.')
  await act(async () => publish({ flowId: 'other', phase: 'waiting', url }))
  await screen.findByText('Finish signing in in your browser.')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(callAntigravityChatSignIn).toHaveBeenCalledWith(owner, 'Cancel', { flowId: 'other' })
  expect(openUrl).not.toHaveBeenCalled()
})
