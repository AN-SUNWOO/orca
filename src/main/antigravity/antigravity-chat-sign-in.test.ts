// The chat sign-in against a scripted Antigravity server.

import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { createFakePipedChild } from '../../shared/__fixtures__/fake-spawned-child'
import type { terminateProviderProcessTree } from '../provider-process/provider-process-teardown'
import { createAcpAgentConnection } from '../acp/acp-agent-connection'
import { ANTIGRAVITY_LAUNCH_SPEC, ANTIGRAVITY_SIGN_IN_PROMPT } from '../acp/acp-launch-specs'
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
async function signInAgainst(link: string) {
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
  const { flowId } = startAntigravityChatSignIn({
    launchSources: async () => ({
      accountHome: { variable: 'GEMINI_HOME', path: folder },
      env: { PATH: bin },
      commandSettings: {},
      dataDirectory: stateDirectory
    }),
    stopLiveChats: async () => {},
    connect: (launch, options) => createAcpAgentConnection(launch, options, () => child)
  })
  return { agent, folder, flowId, finishBrowser: () => browserDone.resolve() }
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
