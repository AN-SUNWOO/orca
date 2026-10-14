// Signs this host's Antigravity chats in with the server's own Google sign-in: a server spawned as a
// chat start spawns one prints the link, then saves the sign-in to the chats' folder itself once
// the browser finishes. One flow per host; a new Start replaces the running one.

import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  requireLegacyAgentSessionAccountHome,
  type AgentSessionAccountHome
} from '../../shared/agent-session-account-home'
import type { AntigravityChatSignInState } from '../../shared/antigravity-account-types'
import { delayUnlessAborted } from '../../shared/abort-aware-delay'
import { createAcpAgentConnection, type AcpAgentConnection } from '../acp/acp-agent-connection'
import {
  ANTIGRAVITY_LAUNCH_SPEC,
  ANTIGRAVITY_SIGN_IN_PROMPT,
  type AcpLaunchSpec
} from '../acp/acp-launch-specs'
import { acpPrivateTempConnect } from '../acp/acp-private-temp'
import type { ConnectAcpAgent } from '../acp/acp-structured-connection'
import { resolveAcpLaunchInvocation } from '../acp/acp-structured-launch-resolution'
import { prepareAcpLaunch } from '../acp/acp-structured-launch-preparation'
import type { structuredAgentHostLaunchSources } from '../runtime/structured-agent-launch-support'

// The server's own wait for the browser; a Link poll stays under a client's 30 s.
const FLOW_DEADLINE_MS = 300_000
const LINK_WAIT_MS = 25_000
const INVALID_LINK = {
  phase: 'failed',
  error: 'Antigravity returned an invalid Google sign-in link.'
} as const

type Phase = AntigravityChatSignInState['phase']
type Flow = {
  state: AntigravityChatSignInState
  ended: AbortController
  changed: PromiseWithResolvers<void>
  done: Promise<void>
}

export type AntigravityChatSignInHost = {
  launchSources(): ReturnType<typeof structuredAgentHostLaunchSources>
  /** Rejects when a chat is not proven stopped. */
  stopLiveChats(): Promise<void>
  connect?: ConnectAcpAgent<AcpAgentConnection>
}

let flow: Flow | null = null

const settled = (phase: Phase): boolean => phase !== 'starting' && phase !== 'waiting'

function publish(current: Flow, next: Omit<AntigravityChatSignInState, 'flowId'>): void {
  if (settled(current.state.phase)) {
    return
  }
  current.state = { flowId: current.state.flowId, ...next }
  if (settled(next.phase)) {
    current.ended.abort()
  }
  current.changed.resolve()
  current.changed = Promise.withResolvers()
}

export function startAntigravityChatSignIn(host: AntigravityChatSignInHost): { flowId: string } {
  // A host whose chats are refused (supportsAcpStructuredLocation) signs none in.
  if (ANTIGRAVITY_LAUNCH_SPEC.managedRuntime?.availableOnHost?.() === false) {
    throw new Error(`Antigravity chats are not available on ${process.platform} ${process.arch}.`)
  }
  const previous = flow
  if (previous) {
    publish(previous, { phase: 'cancelled' })
  }
  const current: Flow = {
    state: { flowId: randomUUID(), phase: 'starting' },
    ended: new AbortController(),
    changed: Promise.withResolvers(),
    done: Promise.resolve()
  }
  flow = current
  // After the replaced flow has let go of the chats' starts.
  current.done = (previous?.done ?? Promise.resolve()).then(() => runFlow(current, host))
  return { flowId: current.state.flowId }
}

async function runFlow(current: Flow, host: AntigravityChatSignInHost): Promise<void> {
  const deadline = setTimeout(() => publish(current, { phase: 'expired' }), FLOW_DEADLINE_MS)
  try {
    current.ended.signal.throwIfAborted()
    await ANTIGRAVITY_LAUNCH_SPEC.launchGate.run(host.stopLiveChats, () => signIn(current, host))
    publish(current, { phase: 'signedIn' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    publish(current, { phase: 'failed', error: message })
  } finally {
    clearTimeout(deadline)
  }
}

async function signIn(current: Flow, host: AntigravityChatSignInHost): Promise<void> {
  const spec: AcpLaunchSpec = ANTIGRAVITY_LAUNCH_SPEC
  const { signal } = current.ended
  const closed = (): void => signal.throwIfAborted()
  const { accountHome, env, commandSettings, dataDirectory } = await host.launchSources()
  const deps = { spec, dataDirectory, connect: host.connect ?? createAcpAgentConnection }
  const resolve = () =>
    resolveAcpLaunchInvocation(spec, accountHome, {
      resolveEnvironment: async () => env,
      resolveCommandSettings: () => commandSettings,
      dataDirectory
    })
  const launch = await prepareAcpLaunch(deps, resolve, signal, closed)
  const connect = await acpPrivateTempConnect(deps, closed)
  const cwd = await mkdtemp(join(tmpdir(), 'orca-antigravity-sign-in-'))
  try {
    const connection = connect(
      { ...launch, args: spec.args({ fullAccess: false, pluginDir: null }), cwd },
      {
        clientInfo: { name: 'orca', version: '1' },
        signInPrompt: spec.signInPrompt,
        signInLink: (line) => {
          const url = antigravitySignInUrl(line)
          publish(current, url ? { phase: 'waiting', url } : INVALID_LINK)
        }
      }
    )
    const stop = (): void => void connection.close()
    signal.addEventListener('abort', stop, { once: true })
    try {
      // Resolves once the browser finishes, or at once when the folder is already signed in.
      await connection.authenticate('oauth-personal')
    } finally {
      signal.removeEventListener('abort', stop)
      await connection.close()
    }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

/** The link only when it is Google's sign-in page sending the browser back to a loopback port on
 *  this host: it is opened for the person, so anything else is withheld. */
export function antigravitySignInUrl(line: string): string | null {
  const link = line.trim().slice(ANTIGRAVITY_SIGN_IN_PROMPT.length).trim()
  if (link.length > 16_384 || /\s/.test(link) || !URL.canParse(link)) {
    return null
  }
  const url = new URL(link)
  const one = (name: string): string =>
    url.searchParams.getAll(name).length === 1 ? (url.searchParams.get(name) ?? '') : ''
  const redirect = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/$/.exec(one('redirect_uri'))
  const port = Number(redirect?.[1])
  const valid =
    url.origin === 'https://accounts.google.com' &&
    url.pathname === '/o/oauth2/v2/auth' &&
    !url.username &&
    !url.password &&
    !url.hash &&
    one('response_type') === 'code' &&
    /^\S{1,512}$/.test(one('state')) &&
    port >= 1024 &&
    port <= 65_535
  return valid ? link : null
}

/** The flow's state once it differs from `shown`, or after a bounded wait that the caller's
 *  disconnect (`signal`) ends early; a replaced flow reads as cancelled. */
export async function readAntigravityChatSignInLink(
  flowId: string,
  shown: Phase | undefined,
  signal?: AbortSignal
): Promise<AntigravityChatSignInState> {
  const current = flow?.state.flowId === flowId ? flow : null
  if (current && current.state.phase === shown && !settled(shown)) {
    const changed = new AbortController()
    void current.changed.promise.then(() => changed.abort())
    await delayUnlessAborted(
      LINK_WAIT_MS,
      AbortSignal.any([changed.signal, ...(signal ? [signal] : [])])
    )
  }
  return current?.state ?? { flowId, phase: 'cancelled' }
}

export function cancelAntigravityChatSignIn(flowId: string): AntigravityChatSignInState {
  if (flow?.state.flowId !== flowId) {
    throw new Error('That Antigravity sign-in is no longer running.')
  }
  publish(flow, { phase: 'cancelled' })
  return flow.state
}

/** `saved` is a stat of the server's own sign-in file; nothing reads it. */
export async function readAntigravityChatSignInStatus(
  accountHome: AgentSessionAccountHome
): Promise<{ saved: boolean; signingIn: boolean }> {
  const token = join(
    requireLegacyAgentSessionAccountHome(accountHome).path,
    'antigravity-acp',
    'acp_token.json'
  )
  const saved = await stat(token).then(
    (file) => file.isFile(),
    () => false
  )
  return { saved, signingIn: flow !== null && !settled(flow.state.phase) }
}
