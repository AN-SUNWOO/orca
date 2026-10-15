import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  importLegacyTranscriptIntoJournal,
  prepareLegacyTranscriptImport
} from './journal-legacy-import'
import { createTrackedJournalOpener } from './journal-host-database-test-support'
import { PI_CONTEXT_FIXTURES } from './journal-pi-context-fixtures'

export function registerJournalPiContextImportTests(): void {
  let root: string
  const journals = createTrackedJournalOpener()
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orca-pi-context-'))
  })
  afterEach(async () => {
    await journals.closeAll()
    await rm(root, { recursive: true, force: true })
  })

  async function prepare(entries: unknown[], version = 3) {
    const filePath = join(root, 'session.jsonl')
    const header = { type: 'session', id: 'session', version, cwd: root }
    // Malformed records do not contribute to Pi's v1 entry indexes.
    await writeFile(
      filePath,
      [JSON.stringify(header), '{bad json', ...entries.map((entry) => JSON.stringify(entry))].join(
        '\n'
      )
    )
    const result = await prepareLegacyTranscriptImport({
      agent: 'pi',
      sessionId: 'session',
      options: { filePath }
    })
    if (!result.ok) {
      throw new Error(result.error)
    }
    return result.items
  }

  describe('saved Pi context import', () => {
    it.each(PI_CONTEXT_FIXTURES)('$name', async (fixture) => {
      const items = await prepare(fixture.entries, 'version' in fixture ? fixture.version : 3)
      expect(
        items.map((item) =>
          item.body.kind === 'message'
            ? item.body.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : []))
            : []
        )
      ).toEqual(fixture.texts.map((text) => [text]))
    })

    it('persists compaction and branch summaries in the adopted journal across reopen', async () => {
      const fixture = PI_CONTEXT_FIXTURES[0]
      if (!fixture) {
        throw new Error('missing compaction fixture')
      }
      const expected = await prepare([
        ...fixture.entries,
        {
          type: 'branch_summary',
          id: 'branch',
          parentId: 'later',
          fromId: 'discarded',
          summary: 'Saved branch details.'
        }
      ])
      const filePath = join(root, 'session.jsonl')
      const options = {
        stateDirectory: join(root, 'journal'),
        identity: {
          sessionId: 'native-chat',
          workspaceId: 'workspace',
          hostId: 'host',
          agent: 'pi' as const,
          providerHandle: { transport: 'jsonl-rpc', agent: 'pi', nativeId: filePath }
        }
      }
      const journal = await journals.open(options)
      expect(
        await importLegacyTranscriptIntoJournal({
          journal,
          agent: 'pi',
          sessionId: 'session',
          fence: 1,
          options: { filePath }
        })
      ).toMatchObject({ ok: true, imported: 4, replaced: true })
      await journal.close()
      const reopened = await journals.open(options)
      expect(reopened.snapshot().items.map((item) => item.body)).toEqual(
        expected.map((item) => item.body)
      )
      expect(JSON.stringify(reopened.snapshot().items)).toContain('Saved branch details.')
    })
  })
}
