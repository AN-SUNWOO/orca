// The chat sign-in against a scripted Antigravity server.

import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { createFakePipedChild } from '../../shared/__fixtures__/fake-spawned-child'
import type { terminateProviderProcessTree } from '../provider-process/provider-process-teardown'
import { createAcpAgentConnection, type AcpAgentConnection } from '../acp/acp-agent-connection'
import { ANTIGRAVITY_LAUNCH_SPEC, ANTIGRAVITY_SIGN_IN_PROMPT } from '../acp/acp-launch-specs'
import { prepareAcpStructuredLaunch } from '../acp/acp-structured-launch-preparation'
import type { ConnectAcpAgent } from '../acp/acp-structured-connection'
import { AcpScriptedAgent, deferred } from '../acp/acp-scripted-agent.test-support'
import {
  antigravitySignInUrl,
  readAntigravityChatSignInLink,
  startAntigravityChatSignIn
} from './antigravity-chat-sign-in'

vi.mock('../provider-process/provider-process-teardown', () => ({
  terminateProviderProcessTree: vi.fn<typeof terminateProviderProcessTree>(
    async () => 'unverifiable'
  )
}))

const GOOGLE_LINK =
  'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=s1&redirect_uri=http%3A%2F%2F127.0.0.1%3A41234%2F'
const folders: string[] = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

/** A sign-in on a scratch data folder whose server prints `link` when asked to authenticate. */
async function signInAgainst(link: string, configure?: (connection: AcpAgentConnection) => void) {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'orca-agy-sign-in-'))
  folders.push(stateDirectory)
  const agent = new AcpScriptedAgent()
  const stderr = new PassThrough()
  const browserDone = deferred<void>()
  agent.on('initialize', (frame) => agent.reply(frame, { protocolVersion: 1 }))
  agent.on('authenticate', (frame) => {
    stderr.write(`${ANTIGRAVITY_SIGN_IN_PROMPT} ${link}\n`)
    void browserDone.promise.then(() => agent.reply(frame, {}))
  })
  const child = Object.assign(createFakePipedChild(), {
    pid: 9_999_998,
    stdout: agent.stdout,
    stdin: agent.stdin,
    stderr,
    kill: vi.fn(() => true)
  })
  child.stdin.once('finish', () => child.emit('exit', 0, null))
  const folder = join(stateDirectory, 'antigravity-chat')
  // A server on PATH, so nothing is downloaded; the chat server ignores the Command setting.
  const bin = join(stateDirectory, 'bin')
  await mkdir(bin)
  await writeFile(join(bin, ANTIGRAVITY_LAUNCH_SPEC.command), '', { mode: 0o755 })
  const host = {
    launchSources: async () => ({
      accountHome: { variable: 'GEMINI_HOME', path: folder },
      env: { PATH: bin },
      commandSettings: {},
      dataDirectory: stateDirectory
    }),
    stopLiveChats: async () => {},
    connect: vi.fn<ConnectAcpAgent<AcpAgentConnection>>((launch, options) => {
      const connection = createAcpAgentConnection(launch, options, () => child)
      configure?.(connection)
      return connection
    })
  }
  const { flowId } = startAntigravityChatSignIn(host)
  return { agent, folder, flowId, host, child, finishBrowser: () => browserDone.resolve() }
}

it('shows the server link, then reads signed in once the browser finishes', async () => {
  const { agent, folder, flowId, finishBrowser } = await signInAgainst(GOOGLE_LINK)
  expect(await readAntigravityChatSignInLink(flowId, 'starting')).toEqual({
    flowId,
    phase: 'waiting',
    url: GOOGLE_LINK
  })
  expect(agent.frames.find((frame) => frame.method === 'authenticate')?.params).toEqual({
    methodId: 'oauth-personal'
  })
  for (const path of [folder, join(folder, 'antigravity-acp')]) {
    expect(process.platform === 'win32' || ((await stat(path)).mode & 0o777) === 0o700).toBe(true)
  }
  finishBrowser()
  expect(await readAntigravityChatSignInLink(flowId, 'waiting')).toEqual({
    flowId,
    phase: 'signedIn'
  })
})

it('never shows a link that is not a Google sign-in back to this host', async () => {
  const foreign = GOOGLE_LINK.replace('accounts.google.com', 'accounts.example.com')
  const { flowId } = await signInAgainst(foreign)
  const state = await readAntigravityChatSignInLink(flowId, 'starting')
  expect(state).toMatchObject({ flowId, phase: 'failed' })
  expect(JSON.stringify(state)).not.toContain('example')
  for (const link of [
    GOOGLE_LINK.replace('127.0.0.1', 'attacker.test'),
    GOOGLE_LINK.replace('41234', '80'),
    `${GOOGLE_LINK}&state=s2`
  ]) {
    expect(antigravitySignInUrl(`${ANTIGRAVITY_SIGN_IN_PROMPT} ${link}`)).toBeNull()
  }
})

it('retains an unclosed sign-in child for both launch entry points until its exit is proven', async () => {
  const close = vi.fn(async () => false)
  const old = await signInAgainst(GOOGLE_LINK, (connection) => {
    vi.spyOn(connection, 'close').mockImplementation(close)
  })
  await readAntigravityChatSignInLink(old.flowId, 'starting')
  old.finishBrowser()
  expect((await readAntigravityChatSignInLink(old.flowId, 'waiting')).phase).toBe('failed')
  const launch = old.host.connect.mock.calls[0][0]
  const { env, cwd, envToDelete } = launch
  if (!env || !cwd || !envToDelete) {
    throw new Error('sign-in launch fields missing')
  }
  expect((await stat(env.TMPDIR)).isDirectory()).toBe(true)
  expect((await stat(cwd)).isDirectory()).toBe(true)
  const next = startAntigravityChatSignIn(old.host)
  expect((await readAntigravityChatSignInLink(next.flowId, 'starting')).phase).toBe('failed')
  expect(old.host.connect).toHaveBeenCalledTimes(1)
  const prepareChat = async () =>
    prepareAcpStructuredLaunch(
      {
        spec: ANTIGRAVITY_LAUNCH_SPEC,
        dataDirectory: (await old.host.launchSources()).dataDirectory,
        resolveLaunch: async () => ({
          ...launch,
          env,
          cwd,
          envToDelete: [...envToDelete],
          spec: ANTIGRAVITY_LAUNCH_SPEC,
          fullAccess: false,
          resume: null
        })
      },
      {
        identity: {
          sessionId: 'retry-chat',
          workspaceId: 'folder',
          hostId: 'local',
          agent: 'antigravity',
          providerHandle: null
        },
        spawnToken: 'retry-chat'
      },
      () => {}
    )
  const gate = ANTIGRAVITY_LAUNCH_SPEC.launchGate.enter(undefined)
  const spawnChat = vi.fn()
  try {
    await expect(prepareChat().then(spawnChat)).rejects.toThrow('could not be stopped')
    expect(close).toHaveBeenCalledTimes(3)
    close.mockImplementationOnce(async () => {
      old.child.emit('exit', 0, null)
      return true
    })
    spawnChat(await prepareChat())
    expect(spawnChat).toHaveBeenCalledTimes(1)
  } finally {
    gate.leave()
  }
  await vi.waitFor(async () => {
    await expect(stat(env.TMPDIR)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
