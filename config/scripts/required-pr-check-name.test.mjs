import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { parse } from 'yaml'

it('reserves the required verify check for the full PR gate', () => {
  const directory = '.github/workflows'
  const providers = readdirSync(directory)
    .filter((file) => /\.ya?ml$/.test(file))
    .flatMap((file) => {
      const workflow = parse(readFileSync(join(directory, file), 'utf8'))
      if (!Object.hasOwn(workflow.on ?? {}, 'pull_request')) {
        return []
      }
      return Object.entries(workflow.jobs)
        .filter(([id, job]) => (job.name ?? id) === 'verify')
        .map(() => file)
    })
  expect(providers).toEqual(['pr.yml'])
})
