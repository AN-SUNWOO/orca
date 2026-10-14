import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentHookServer } from './server'
import { buildBody, postHookEvent } from './server.test-fixtures'

// Captured from a completed Codex CLI 0.159.0 /review; session and turn IDs were replaced.
const reviewRecords = readFileSync(
  new URL('./__fixtures__/codex-review-child-0159.jsonl', import.meta.url),
  'utf8'
)
  .trimEnd()
  .split('\n')

describe('Codex review turn completion', () => {
  let server: AgentHookServer | undefined
  let directory: string | undefined

  afterEach(() => {
    server?.stop()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('settles the main agent from the review child rollout without Stop and leaves a newer turn working', async () => {
    directory = mkdtempSync(join(tmpdir(), 'codex-review-turn-'))
    const childPath = join(directory, 'review-child.jsonl')
    writeFileSync(childPath, `${reviewRecords[0]}\n`)
    server = new AgentHookServer()
    await server.start({ env: 'production' })

    // Real review hooks carry the root session ID and child turn/path, with no agent_id or Stop.
    for (const hookEventName of [
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PreToolUse',
      'PostToolUse'
    ] as const) {
      const response = await postHookEvent(
        server,
        buildBody({
          hook_event_name: hookEventName,
          session_id: 'root-session',
          transcript_path: childPath,
          turn_id: 'child-turn',
          ...(hookEventName === 'UserPromptSubmit' ? { prompt: 'Review current changes' } : {}),
          ...(hookEventName === 'UserPromptSubmit' ? {} : { tool_name: 'Bash' })
        }),
        '/hook/codex'
      )
      expect(response.status).toBe(204)
    }
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'working',
      mainAgent: { state: 'working' },
      providerSession: { id: 'root-session', transcriptPath: childPath }
    })

    appendFileSync(childPath, `${reviewRecords[1]}\n`)
    await vi.waitFor(
      () => {
        expect(server?.getStatusSnapshot()[0]).toMatchObject({
          state: 'done',
          mainAgent: { state: 'done' }
        })
      },
      { timeout: 3_000 }
    )

    const nextPath = join(directory, 'next-root.jsonl')
    writeFileSync(
      nextPath,
      '{"type":"event_msg","payload":{"type":"task_started","turn_id":"next-turn"}}\n'
    )
    const next = await postHookEvent(
      server,
      buildBody({
        hook_event_name: 'UserPromptSubmit',
        session_id: 'root-session',
        transcript_path: nextPath,
        turn_id: 'next-turn',
        prompt: 'Next task'
      }),
      '/hook/codex'
    )
    expect(next.status).toBe(204)
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'working',
      mainAgent: { state: 'working' },
      providerSession: { transcriptPath: nextPath }
    })
  })
})
