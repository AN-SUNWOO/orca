export type AntigravityAccountSummary = {
  id: string
  email: string | null
  subject: string | null
  authMethod: string
  createdAt: number
  updatedAt: number
}

export type AntigravityAccountState = {
  accounts: AntigravityAccountSummary[]
  activeAccountId: string | null
  currentAccount: {
    email: string | null
    subject: string | null
    authMethod: string
    identityKnown: boolean
  } | null
  selectedAccountId: string | null
  /** This host's chat sign-in; absent from a host without `accounts.antigravity-chat-sign-in.v1`.
   *  `saved` says a sign-in file exists, not that it still works. `flowId` names the running
   *  sign-in, absent from an older host. */
  chatSignIn?: { saved: boolean; signingIn: boolean; flowId?: string }
}

export const ANTIGRAVITY_CHAT_SIGN_IN_PHASES = [
  'starting',
  'waiting',
  'signedIn',
  'failed',
  'cancelled',
  'expired'
] as const

/** Where a chat sign-in flow on the execution host stands; `url` is the Google page to open. */
export type AntigravityChatSignInState = {
  flowId: string
  phase: (typeof ANTIGRAVITY_CHAT_SIGN_IN_PHASES)[number]
  url?: string
  error?: string
}

export type AntigravityAccountTarget = {
  runtime: 'host' | 'wsl'
  wslDistro?: string | null
}
