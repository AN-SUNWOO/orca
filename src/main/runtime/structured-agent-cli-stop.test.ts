import { beforeEach, expect, it, vi } from 'vitest'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import type { CliSourceStopHost } from './structured-agent-cli-stop'

const processTable = vi.hoisted(() => ({
  read: vi.fn(),
  capture: vi.fn()
}))
vi.mock('../pty-descendant-termination', async (importOriginal) => ({
  ...await importOriginal<typeof import('../pty-descendant-termination')>(),
  readProcessTable: processTable.read,
  captureDescendantSnapshot: processTable.capture
}))

import {
  captureCliSourceProcessIdentities,
  inspectCliSourceWriters,
  probeCliSourceSurvivors
} from './structured-agent-cli-stop'

const row = (paneKey: string): AgentStatusIpcPayload => ({
  paneKey,
  worktreeId: 'workspace-1',
  agentType: 'claude',
  state: 'working',
  prompt: '',
  connectionId: null,
  receivedAt: 1,
  stateStartedAt: 1,
  providerSession: { key: 'session_id', id: 'conversation-1', transcriptPath: '/saved.jsonl' }
})
const input = {
  agent: 'claude',
  workspaceId: 'workspace-1',
  resumeFrom: {
    providerSessionId: 'conversation-1',
    cliSource: { workspaceId: 'workspace-1', paneKey: 'source', stopRunningAgent: true }
  }
}
function host(rows: AgentStatusIpcPayload[]): CliSourceStopHost {
  return {
    rows: () => rows,
    resolvePane: (paneKey) => ({ ptyId: paneKey, connected: true }),
    sleeping: () => false,
    presence: async () => 'live',
    shellForeground: async () => false,
    rootPid: async () => 123,
    stop: async () => ({ postStopVerified: true })
  }
}

beforeEach(() => {
  processTable.read.mockReset()
  processTable.capture.mockReset()
})

it('refuses an unconsented writer or another live pane before any stop', async () => {
  await expect(inspectCliSourceWriters(host([row('source')]), {
    ...input, resumeFrom: { ...input.resumeFrom, cliSource: {
      ...input.resumeFrom.cliSource, stopRunningAgent: false
    } }
  })).rejects.toMatchObject({ refusal: { details: { reason: 'conversationHeldElsewhere' } } })
  await expect(inspectCliSourceWriters(host([row('source'), row('other')]), input))
    .rejects.toMatchObject({ refusal: { details: { reason: 'conversationHeldElsewhere' } } })
  expect(await inspectCliSourceWriters(host([row('source')]), input)).toMatchObject({
    ptyId: 'source', writerMayLive: true
  })
  await expect(inspectCliSourceWriters(host([{ ...row('source'), state: 'done' }]), {
    ...input, resumeFrom: { ...input.resumeFrom, cliSource: {
      ...input.resumeFrom.cliSource, stopRunningAgent: false
    } }
  })).rejects.toMatchObject({ refusal: { details: { reason: 'conversationHeldElsewhere' } } })
  await expect(inspectCliSourceWriters(host([{ ...row('source'), state: 'done' }]), {
    ...input, resumeFrom: { ...input.resumeFrom, cliSource: {
      workspaceId: 'workspace-1', paneKey: 'source'
    } }
  })).rejects.toMatchObject({ refusal: { details: { reason: 'conversationHeldElsewhere' } } })
})

it('keeps a sleeping pane held even without a current PTY', async () => {
  const source = host([row('source')])
  source.resolvePane = () => ({ ptyId: null, connected: false })
  source.sleeping = () => true
  await expect(inspectCliSourceWriters(source, input)).rejects.toMatchObject({
    refusal: { details: { reason: 'conversationHeldElsewhere' } }
  })
})

it('re-probes the captured identity after its child re-parents away from the PTY', async () => {
  if (process.platform === 'win32') {
    return
  }
  processTable.capture.mockResolvedValue({
    root: { pid: 123, startedAt: 'root-start' },
    rootPgid: 123,
    descendants: [{ pid: 456, startedAt: 'child-start' }]
  })
  const captured = await captureCliSourceProcessIdentities(host([row('source')]), 'source')
  processTable.read.mockResolvedValue({ rows: [{ pid: 456, startedAt: 'child-start' }] })
  expect(await probeCliSourceSurvivors(captured)).toEqual([captured[1]])
  processTable.read.mockResolvedValue({ rows: [] })
  expect(await probeCliSourceSurvivors(captured)).toEqual([])
  processTable.read.mockRejectedValue(new Error('table unreadable'))
  expect(await probeCliSourceSurvivors(captured)).toEqual(captured)
})
