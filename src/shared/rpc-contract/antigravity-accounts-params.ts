import { z } from 'zod'
import { ANTIGRAVITY_CHAT_SIGN_IN_PHASES } from '../antigravity-account-types'

export const AntigravityAccountTargetParams = z
  .object({
    runtime: z.enum(['host', 'wsl']),
    wslDistro: z.string().min(1).max(255).nullable().optional()
  })
  .strict()

export const AntigravityAccountMutationParams = z
  .object({
    target: AntigravityAccountTargetParams,
    accountId: z.string().min(1).max(128)
  })
  .strict()

export const AntigravityChatSignInFlowParams = z
  .object({
    flowId: z.string().min(1).max(64),
    /** The phase the client already shows: the host answers once it differs. */
    shown: z.enum(ANTIGRAVITY_CHAT_SIGN_IN_PHASES).optional()
  })
  .strict()
