import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CLAUDE_CLI_CONVERSATIONS } from '../claude/claude-cli-conversations'
import { resolveStructuredAgentSessionAdoptionForCreate } from '../runtime/structured-agent-session-create-adoption'
import { structuredAgentCliSourcePath } from './structured-agent-cli-source'
import { prepareAdoptedTranscript } from './agent-session-wire/structured-agent-session-adopted-import'
import type { AgentSessionAttachParams } from './agent-session-wire/structured-agent-session-attach'
import type { StructuredAgentId } from '../../shared/agent-session-provider-handle'
import { prepareLegacyTranscriptImport } from './agent-session-journal/journal-legacy-import'
import { prepareCodexAdoption } from './codex-adoption-preparation'
import { prepareLegacySharedCodexSessionResume } from '../codex/codex-legacy-session-resume'
import * as codexHomes from '../codex/codex-home-paths'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'orca-source-admission-')) })
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }) })
const id = 'provider-session'
async function file(path: string, records: unknown[]) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
  return path
}
function params(agent: StructuredAgentId, transcriptPath: string): AgentSessionAttachParams {
  return {
    envelope: { sessionId: 'new-chat', clientOperationId: 'create', expectedRuntimeFence: null, payloadFingerprint: '' },
    location: { executionHostId: 'local', workspaceId: 'folder', workspaceKind: 'folder', wslDistro: null },
    agent, provider: agent, runtimeKind: 'native', accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: root },
    adopt: { providerHandle: { agent, transport: 'terminal-transcript', nativeId: id }, transcriptPath,
      source: { providerSessionId: id, workspaceCwd: root } }
  }
}

it('creates from the host hook path when Claude filename differs, then checks actual recorded cwd', async () => {
  const transcriptPath = await file(join(root, 'projects', 'folder', 'different-uuid.jsonl'), [
    { type: 'user', uuid: 'first', sessionId: id, cwd: root, message: { role: 'user', content: 'hello' } },
    { type: 'assistant', uuid: 'reply', sessionId: id, cwd: '/later-drift', message: { role: 'assistant', content: 'reply' } }
  ])
  const sourcePath = () => structuredAgentCliSourcePath({
    agent: 'claude', workspaceId: 'folder', resumeFrom: { providerSessionId: id,
      cliSource: { workspaceId: 'folder', paneKey: 'tab:leaf' } },
    rows: [{ paneKey: 'tab:leaf', worktreeId: 'folder', agentType: 'claude', state: 'waiting', prompt: '',
      connectionId: null, receivedAt: 1, stateStartedAt: 1,
      providerSession: { key: 'session_id', id, transcriptPath } }]
  })
  const importer = CLAUDE_CLI_CONVERSATIONS.transcriptImport!
  const find = vi.spyOn(importer, 'findTranscript')
  const adoption = await resolveStructuredAgentSessionAdoptionForCreate({
    host: null, settings: {}, agent: 'claude', transcriptImport: importer, providerSessionId: id,
    selfSessionId: 'new-chat', selectedAccountHome: { variable: 'CLAUDE_CONFIG_DIR', path: root },
    launchEnv: {}, workspaceCwd: root, resolveTranscriptPath: sourcePath
  })
  expect(adoption.transcriptPath).toBe(transcriptPath)
  expect(find).not.toHaveBeenCalled()
  expect(await prepareAdoptedTranscript(params('claude', adoption.transcriptPath))).toMatchObject({ ok: true })
  const wrongDirectory = params('claude', adoption.transcriptPath)
  if (wrongDirectory.adopt?.source) {
    wrongDirectory.adopt.source.workspaceCwd = '/another-folder'
  }
  expect(await prepareAdoptedTranscript(wrongDirectory)).toMatchObject({ ok: false,
    refusal: { details: { reason: 'transcriptUnreadable' } } })

  const foreign = await file(join(root, 'foreign.jsonl'), [])
  const escaped = process.platform === 'win32' ? foreign : join(root, 'projects', 'escaped.jsonl')
  if (process.platform !== 'win32') {
    await symlink(foreign, escaped)
  }
  await expect(resolveStructuredAgentSessionAdoptionForCreate({
    host: null, settings: {}, agent: 'claude', transcriptImport: importer, providerSessionId: id,
    selfSessionId: 'another-chat', selectedAccountHome: { variable: 'CLAUDE_CONFIG_DIR', path: root },
    launchEnv: {}, workspaceCwd: root, resolveTranscriptPath: () => escaped
  })).rejects.toMatchObject({ refusal: { details: { reason: 'transcriptUnreadable' } } })
  expect(find).not.toHaveBeenCalled()
})

it('checks canonical provider metadata during the existing import, including Codex copied parent metadata', async () => {
  const codex = await file(join(root, 'rollout.jsonl'), [
    { type: 'session_meta', payload: { id } },
    { type: 'session_meta', payload: { id: 'copied-parent' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: 'hello' } }
  ])
  expect(await prepareAdoptedTranscript(params('codex', codex))).toMatchObject({ ok: true })
  for (const agent of ['omp', 'pi'] as const) {
    const transcript = await file(join(root, `${id}.jsonl`), [
      { type: 'session', id, cwd: root },
      { type: 'message', id: 'turn', message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } }
    ])
    expect(await prepareAdoptedTranscript(params(agent, transcript))).toMatchObject({ ok: true })
    await file(transcript, [{ type: 'session', id: 'foreign', cwd: root }])
    expect(await prepareAdoptedTranscript(params(agent, transcript))).toMatchObject({ ok: false })
  }
  const grok = await file(join(root, id, 'chat_history.jsonl'), [{ type: 'user', content: 'hello' }])
  await file(join(root, id, 'summary.json'), [{ info: { id, cwd: root } }])
  expect(await prepareAdoptedTranscript(params('grok', grok))).toMatchObject({ ok: true })
  await rm(join(root, id, 'summary.json'))
  expect(await prepareAdoptedTranscript(params('grok', grok))).toMatchObject({ ok: false,
    refusal: { details: { reason: 'transcriptUnreadable' } } })
  await writeFile(codex, '{malformed json')
  expect(await prepareLegacyTranscriptImport({ agent: 'codex', sessionId: id,
    options: { filePath: codex, source: { providerSessionId: id, workspaceCwd: root } } })).toMatchObject({ ok: false })
})

it('materializes legacy Codex into the system home and pins a verified selected account alias', async () => {
  const legacy = join(root, 'legacy')
  const system = join(root, 'system')
  const selected = join(root, 'codex-accounts', 'selected', 'home')
  const suffix = join('sessions', '2026', '10', '15', `rollout-stamp-${id}.jsonl`)
  const transcriptPath = await file(join(legacy, suffix), [{ type: 'session_meta', payload: { id } }])
  vi.spyOn(codexHomes, 'getSystemCodexHomePath').mockReturnValue(system)
  const source = { accountHome: { variable: 'CODEX_HOME' as const, path: legacy }, transcriptPath }
  const migrated = await prepareCodexAdoption(source, id,
    (args) => prepareLegacySharedCodexSessionResume(args, {
      legacyCodexHomePath: legacy, systemCodexHomePath: system, isHostSystemDefaultRealHomeSelected: () => true
    }), [source.accountHome])
  expect(migrated).toEqual({ accountHome: { variable: 'CODEX_HOME', path: system }, transcriptPath: join(system, suffix) })
  await file(join(selected, suffix), [{ type: 'session_meta', payload: { id } }])
  expect(await prepareCodexAdoption(migrated, id, async () => ({ useRealCodexHome: false, substituteCodexHome: selected }),
    [{ variable: 'CODEX_HOME', path: selected }])).toEqual({ accountHome: { variable: 'CODEX_HOME', path: selected }, transcriptPath: join(selected, suffix) })
  await expect(prepareCodexAdoption(source, id, async () => { throw new Error('EACCES selected account') },
    [source.accountHome])).rejects.toThrow('EACCES selected account')
})
