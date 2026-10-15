import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runProcess } from '@orca/process-host'
import {
  aggregateEnvironment,
  aggregateMarker,
  aggregateNeeds,
  aggregateRequiredJobs as requiredJobs,
  aggregateSelectors,
  aggregateShell as gate,
  aggregateShouldRun,
  aggregateVariable as variable
} from './pr-aggregate-gate-context.mjs'

function requiredResults(shouldRun) {
  return Object.fromEntries(
    requiredJobs.flatMap((job) => [
      [variable(job), shouldRun ? 'success' : 'skipped'],
      [`${variable(job)}_SHOULD_RUN`, String(shouldRun)]
    ])
  )
}

async function verify(results) {
  return runProcess({
    program: 'bash',
    args: ['-c', gate.run],
    env: {
      ...process.env,
      ORCA_BACKGROUND_LAUNCH: '1',
      CODE_PATHS: 'success',
      SHOULD_RUN: 'true',
      ...results
    },
    timeoutMs: 10_000
  })
}

async function verifyCases(environments, script, env = {}) {
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
  const cases = environments.map((environment, index) => {
    const exports = Object.entries(environment)
      .map(([name, value]) => `export ${name}=${quote(value)}`)
      .join('\n')
    return `(\n${exports}\n${script}\n)\nprintf 'AGGREGATE_CASE_${index}=%s\\n' "$?"`
  })
  const directory = mkdtempSync(join(tmpdir(), 'orca-aggregate-cases-'))
  const file = join(directory, 'cases.sh')
  try {
    writeFileSync(file, cases.join('\n'))
    const result = await runProcess({
      program: 'bash',
      args: [file],
      env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1', ...env },
      timeoutMs: 10_000
    })
    expect(result.code, result.stderr).toBe(0)
    return [...result.stdout.matchAll(/^AGGREGATE_CASE_\d+=(\d+)$/gm)].map((match) =>
      Number(match[1])
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

// The aggregate runs as Bash on Linux; Windows has no required Bash installation.
describe.skipIf(process.platform === 'win32')(
  'readiness reuse through the real aggregate gate',
  () => {
    it('accepts completed required checks or skips authorized by exact-source evidence', async () => {
      expect((await verify(requiredResults(true))).code).toBe(0)
      expect((await verify(requiredResults(false))).code).toBe(0)
    })

    it('rejects every missing, failed or cancelled required result when reuse is unavailable', async () => {
      for (const job of requiredJobs) {
        for (const result of ['', 'skipped', 'failure', 'cancelled']) {
          const verdict = await verify({ ...requiredResults(true), [variable(job)]: result })
          expect(verdict.code, `${job}: ${result}`).toBe(1)
        }
      }
    })

    it('requires the detector to succeed even when every downstream job is skipped', async () => {
      for (const result of ['', 'skipped', 'failure', 'cancelled']) {
        expect((await verify({ ...requiredResults(false), CODE_PATHS: result })).code).toBe(1)
      }
    })

    it('rejects unexpected downstream execution when the proven plan requires skips', async () => {
      for (const job of requiredJobs) {
        const verdict = await verify({ ...requiredResults(false), [variable(job)]: 'success' })
        expect(verdict.code, job).toBe(1)
      }
    })

    it('emits the numeric fast-path marker only for exact lowercase routing values', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'orca-aggregate-marker-'))
      const output = join(directory, 'output')
      const valid = Object.fromEntries(aggregateSelectors.map((job) => [variable(job), 'true']))
      const cases = [
        valid,
        Object.fromEntries(aggregateSelectors.map((job) => [variable(job), 'false']))
      ]
      const expected = ['canonical=1', 'canonical=1']
      for (const job of aggregateSelectors) {
        for (const value of [
          'true',
          'false',
          '',
          'TRUE',
          'True',
          'FALSE',
          '0',
          '1',
          'null',
          'unknown',
          ' true',
          'true\n'
        ]) {
          cases.push({ ...valid, [variable(job)]: value })
          expected.push(value === 'true' || value === 'false' ? 'canonical=1' : 'canonical=0')
        }
      }
      try {
        expect(await verifyCases(cases, aggregateMarker.run, { GITHUB_OUTPUT: output })).toEqual(
          cases.map(() => 0)
        )
        expect(readFileSync(output, 'utf8').trimEnd().split('\n')).toEqual(expected)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    })

    it('matches the original shell for successful routing, all dependency mismatches and malformed selectors', async () => {
      const cases = [aggregateNeeds('true'), aggregateNeeds('false')]
      for (const selected of ['true', 'false']) {
        for (const job of ['code_paths', ...requiredJobs]) {
          for (const result of ['success', 'skipped', 'failure', 'cancelled', '', 'unknown']) {
            const needs = aggregateNeeds(selected)
            needs[job].result = result
            cases.push(needs)
          }
        }
      }
      for (const job of aggregateSelectors) {
        for (const selected of [
          '',
          'TRUE',
          'FALSE',
          '0',
          'unknown',
          ' true',
          'true\n',
          undefined
        ]) {
          const matching = aggregateNeeds('false', { [job]: selected, verify_fast_path: '0' })
          cases.push(matching)
          const mismatched = structuredClone(matching)
          const affected = ['static_analysis', 'typecheck'].includes(job) ? 'preflight' : job
          mismatched[affected].result =
            matching[affected].result === 'success' ? 'skipped' : 'success'
          cases.push(mismatched)
        }
      }
      const results = await verifyCases(cases.map(aggregateEnvironment), gate.run)
      expect(results).toHaveLength(cases.length)
      for (const [index, needs] of cases.entries()) {
        const runs = aggregateShouldRun({ needs }).coerceString() === 'true'
        if (needs.code_paths.outputs.verify_fast_path === '0') {
          expect(runs, `fallback case ${index}`).toBe(true)
        } else {
          expect(runs, `canonical case ${index}`).toBe(results[index] !== 0)
        }
      }
    })
  }
)
