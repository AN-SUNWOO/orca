import { defineMethod } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import {
  AntigravityAccountMutationParams,
  AntigravityAccountTargetParams,
  AntigravityChatSignInFlowParams,
  AntigravityChatSignInStatusParams
} from '../../../../shared/rpc-contract/antigravity-accounts-params'
import { getAntigravityAccountService } from '../../../antigravity/native-account-host'
import {
  cancelAntigravityChatSignIn,
  readAntigravityChatSignInStatus,
  startAntigravityChatSignIn
} from '../../../antigravity/antigravity-chat-sign-in'
import { stopStructuredAgentChats } from '../../structured-agent-chat-stop'

const chatSignInHost = (runtime: OrcaRuntimeService) => ({
  launchSources: () => runtime.resolveStructuredAgentHostLaunchSources('antigravity'),
  stopLiveChats: () => stopStructuredAgentChats('antigravity', 'Antigravity')
})

export const ANTIGRAVITY_ACCOUNT_METHODS = [
  defineMethod({
    name: 'accounts.antigravityList',
    permission: 'workspace',
    params: AntigravityAccountTargetParams,
    handler: async (target) => getAntigravityAccountService(target).listAccounts()
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
    name: 'accounts.antigravityChatSignInStatus',
    permission: 'accounts-admin',
    params: AntigravityChatSignInStatusParams,
    handler: async ({ shown }, { runtime, signal }) =>
      readAntigravityChatSignInStatus(
        await runtime.resolveStructuredAgentAccountHome('antigravity'),
        shown,
        signal
      )
  }),
  defineMethod({
    name: 'accounts.antigravityChatSignInCancel',
    permission: 'accounts-admin',
    params: AntigravityChatSignInFlowParams,
    handler: async ({ flowId }) => cancelAntigravityChatSignIn(flowId)
  })
]
