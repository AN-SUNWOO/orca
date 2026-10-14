import type {
  AntigravityAccountState,
  AntigravityAccountTarget,
  AntigravityChatSignInState
} from '../../../shared/antigravity-account-types'
import {
  ANTIGRAVITY_ACCOUNTS_RUNTIME_CAPABILITY,
  ANTIGRAVITY_CHAT_SIGN_IN_RUNTIME_CAPABILITY
} from '../../../shared/account-runtime-capabilities'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import { assertRuntimeEnvironmentCapability, callRuntimeRpc } from './runtime-rpc-client'

export async function callAntigravityAccounts(
  owner: RuntimeClientTarget,
  target: AntigravityAccountTarget,
  action: 'List' | 'AddCurrent' | 'Select' | 'Remove',
  accountId?: string
): Promise<AntigravityAccountState> {
  if (owner.kind === 'environment') {
    await assertRuntimeEnvironmentCapability(
      owner.environmentId,
      ANTIGRAVITY_ACCOUNTS_RUNTIME_CAPABILITY,
      'This execution host does not support native Antigravity Accounts yet. Update Orca on that host.'
    )
  }
  return callRuntimeRpc(
    owner,
    `accounts.antigravity${action}`,
    action === 'List' || action === 'AddCurrent' ? target : { target, accountId },
    { timeoutMs: 20_000 }
  )
}

export async function callAntigravityChatSignIn<TResult = AntigravityChatSignInState>(
  owner: RuntimeClientTarget,
  action: 'Start' | 'Link' | 'Cancel',
  params?: { flowId: string; shown?: AntigravityChatSignInState['phase'] }
): Promise<TResult> {
  if (owner.kind === 'environment') {
    await assertRuntimeEnvironmentCapability(
      owner.environmentId,
      ANTIGRAVITY_CHAT_SIGN_IN_RUNTIME_CAPABILITY,
      'This execution host does not support Antigravity chat sign-in yet. Update Orca on that host.'
    )
  }
  // Link waits up to 25 s on the host for the phase to change.
  return callRuntimeRpc(owner, `accounts.antigravityChatSignIn${action}`, params, {
    timeoutMs: action === 'Link' ? 35_000 : 20_000
  })
}
