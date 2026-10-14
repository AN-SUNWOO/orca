import { defineMethod } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import {
  AntigravityAccountMutationParams,
  AntigravityAccountTargetParams,
  AntigravityChatSignInFlowParams
} from '../../../../shared/rpc-contract/antigravity-accounts-params'
import { getAntigravityAccountService } from '../../../antigravity/native-account-host'
import {
  cancelAntigravityChatSignIn,
  readAntigravityChatSignInLink,
  readAntigravityChatSignInStatus,
  startAntigravityChatSignIn
} from '../../../antigravity/antigravity-chat-sign-in'
import { getStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'

/** Stops each running Antigravity chat on this host as a worktree teardown stops its chats; the
 *  chat stays, and its next send starts the agent again. */
async function stopLiveAntigravityChats(): Promise<void> {
  const host = getStructuredAgentSessionHost()
  if (!host) {
    return
  }
  const ids = host.loadedSessionIds().filter((id) => host.sessionAgent(id) === 'antigravity')
  await Promise.all(ids.map((id) => host.close(id, 'evict')))
  // A close that could not prove its child gone keeps it loaded.
  if (host.loadedSessionIds().some((id) => ids.includes(id))) {
    throw new Error('An Antigravity chat on this host could not be stopped. Try again.')
  }
}

const chatSignInHost = (runtime: OrcaRuntimeService) => ({
  launchSources: () => runtime.resolveStructuredAgentHostLaunchSources('antigravity'),
  stopLiveChats: stopLiveAntigravityChats
})

export const ANTIGRAVITY_ACCOUNT_METHODS = [
  defineMethod({
    name: 'accounts.antigravityList',
    permission: 'workspace',
    params: AntigravityAccountTargetParams,
    handler: async (target, { runtime }) => ({
      ...(await getAntigravityAccountService(target).listAccounts()),
      chatSignIn: await readAntigravityChatSignInStatus(
        await runtime.resolveStructuredAgentAccountHome('antigravity')
      )
    })
  }),
  defineMethod({
    name: 'accounts.antigravityAddCurrent',
    permission: 'accounts-admin',
    params: AntigravityAccountTargetParams,
    handler: async (target) => getAntigravityAccountService(target).addCurrentAccount()
  }),
  defineMethod({
    name: 'accounts.antigravitySelect',
    permission: 'accounts-admin',
    params: AntigravityAccountMutationParams,
    handler: async ({ target, accountId }) =>
      getAntigravityAccountService(target).selectAccount(accountId)
  }),
  defineMethod({
    name: 'accounts.antigravityRemove',
    permission: 'accounts-admin',
    params: AntigravityAccountMutationParams,
    handler: async ({ target, accountId }) =>
      getAntigravityAccountService(target).removeAccount(accountId)
  }),
  // The sign-in runs on this execution host, whichever client asks, as its chats do.
  defineMethod({
    name: 'accounts.antigravityChatSignInStart',
    permission: 'accounts-admin',
    params: null,
    handler: async (_, { runtime }) => startAntigravityChatSignIn(chatSignInHost(runtime))
  }),
  defineMethod({
    name: 'accounts.antigravityChatSignInLink',
    permission: 'accounts-admin',
    params: AntigravityChatSignInFlowParams,
    handler: async ({ flowId, shown }, { signal }) =>
      readAntigravityChatSignInLink(flowId, shown, signal)
  }),
  defineMethod({
    name: 'accounts.antigravityChatSignInCancel',
    permission: 'accounts-admin',
    params: AntigravityChatSignInFlowParams,
    handler: async ({ flowId }) => cancelAntigravityChatSignIn(flowId)
  })
]
