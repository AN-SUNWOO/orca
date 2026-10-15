// Every phone gets bounded frames, whatever version its shell or page is; other clients keep the
// frames they had, `commands` included.

import { afterEach, beforeEach, expect, it } from 'vitest'
import type { AgentSessionSubscribeInput } from '../../../native-chat/agent-session-wire/structured-agent-session-subscribers'
import { AGENT_SESSION_SNAPSHOT_CATCH_UP_CLIENT_CAPABILITY } from '../../../../shared/protocol-version'
import { AGENT_SESSION_CURRENT_REQUESTS_CLIENT_CAPABILITY } from '../../../../shared/agent-session-current-requests-capability'
import { DESKTOP_RENDERER_RUNTIME_CLIENT_CAPABILITIES } from '../../../ipc/desktop-renderer-runtime-capabilities'
import {
  call,
  clearStructuredHostStub,
  hostCalls,
  installStructuredHostStub,
  SESSION,
  STRUCTURED_CLIENT,
  STRUCTURED_MOBILE_CLIENT
} from './structured-agent-session-rpc.test-fixture'

beforeEach(installStructuredHostStub)
afterEach(clearStructuredHostStub)

const currentDesktop = {
  ...STRUCTURED_CLIENT,
  clientCapabilities: [
    ...STRUCTURED_CLIENT.clientCapabilities,
    AGENT_SESSION_SNAPSHOT_CATCH_UP_CLIENT_CAPABILITY,
    AGENT_SESSION_CURRENT_REQUESTS_CLIENT_CAPABILITY
  ]
}

it.each([
  // Being a phone is enough: no capability or param is asked of it.
  ['a phone of any version', STRUCTURED_MOBILE_CLIENT, true, true],
  ['an older paired desktop', STRUCTURED_CLIENT, false, false],
  [
    'a desktop that only settles skipped sends',
    {
      ...STRUCTURED_CLIENT,
      clientCapabilities: [
        ...STRUCTURED_CLIENT.clientCapabilities,
        AGENT_SESSION_SNAPSHOT_CATCH_UP_CLIENT_CAPABILITY
      ]
    },
    false,
    false
  ],
  ['an updated paired desktop', currentDesktop, false, true],
  ['an in-process reader', undefined, false, true]
] as const)('subscribes %s with bounded frames: %s', async (_label, client, bounded, snapshot) => {
  let input: AgentSessionSubscribeInput | undefined
  hostCalls.subscribe.mockImplementation((opened: AgentSessionSubscribeInput) => {
    input = opened
    opened.emit({ type: 'end' })
    return () => {}
  })
  await call('agentSession.subscribe', { sessionId: SESSION }, client)
  expect(input?.boundedFrames === true).toBe(bounded)
  expect(input?.snapshotCatchUp).toBe(snapshot)
})

it('allows the local desktop renderer to replace a missed gap with a snapshot', async () => {
  let input: AgentSessionSubscribeInput | undefined
  hostCalls.subscribe.mockImplementation((opened: AgentSessionSubscribeInput) => {
    input = opened
    opened.emit({ type: 'end' })
    return () => {}
  })
  const cursor = { epoch: 'epoch-a', sequence: 10 }
  await call('agentSession.subscribe', { sessionId: SESSION, cursor }, {
    clientId: 'desktop-renderer',
    clientKind: 'runtime',
    clientCapabilities: [...DESKTOP_RENDERER_RUNTIME_CLIENT_CAPABILITIES]
  })
  expect(input?.cursor).toEqual(cursor)
  expect(input?.snapshotCatchUp).toBe(true)
})
