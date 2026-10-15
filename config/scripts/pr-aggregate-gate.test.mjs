import { describe, expect, it } from 'vitest'
import {
  aggregateJob,
  aggregateMarker,
  aggregateNeeds,
  aggregateRequiredJobs,
  aggregateSelectors,
  aggregateShell,
  aggregateShouldRun,
  aggregateVariable,
  aggregateWorkflow,
  compileAggregateExpression
} from './pr-aggregate-gate-context.mjs'

const results = ['success', 'failure', 'cancelled', 'skipped', '', 'unknown', undefined, null]
const malformedSelectors = [
  '',
  'TRUE',
  'True',
  'FALSE',
  '0',
  '1',
  'null',
  'unknown',
  ' true',
  'true\n',
  undefined,
  null
]
const admitted = (needs, cancelled = false) =>
  aggregateShouldRun({ needs }, cancelled).coerceString() === 'true'

describe('runner-free PR aggregate success', () => {
  it('keeps every required dependency and the existing failure reporter', () => {
    expect(aggregateJob.name).toBe('PR checks passed')
    expect(aggregateJob.needs).toEqual([
      'code_paths',
      'preflight',
      ...aggregateSelectors.filter((job) => job !== 'static_analysis' && job !== 'typecheck')
    ])
    for (const job of ['e2e', 'terminal_ime_native', 'windows_wsl', 'unit_selection_evidence']) {
      expect(aggregateJob.needs).not.toContain(job)
    }
    expect(aggregateJob['continue-on-error']).toBeUndefined()
    expect(aggregateShell['continue-on-error']).toBeUndefined()
    expect(aggregateJob.if).toMatch(/^!cancelled\(\) && !\(/)
    expect(aggregateShell.run).toContain('"$CODE_PATHS" != "success"')
    const checked = [...aggregateShell.run.matchAll(/^check_job (\S+) /gm)].map((match) => match[1])
    expect(checked).toEqual(aggregateRequiredJobs)
  })

  it('validates the same effective selectors the detector publishes, after readiness and classification', () => {
    const detector = aggregateWorkflow.jobs.code_paths
    expect(Object.keys(aggregateMarker.env).sort()).toEqual(
      aggregateSelectors.map(aggregateVariable).sort()
    )
    for (const job of aggregateSelectors) {
      expect(aggregateMarker.env[aggregateVariable(job)], job).toBe(detector.outputs[job])
    }
    expect(detector.outputs.verify_fast_path).toBe(
      '${{ steps.verify_fast_path.outputs.canonical }}'
    )
    const position = detector.steps.indexOf(aggregateMarker)
    for (const id of ['readiness', 'filter']) {
      expect(position).toBeGreaterThan(detector.steps.findIndex((step) => step.id === id))
    }
    expect(aggregateMarker.if).toBeUndefined()
    expect(aggregateMarker['continue-on-error']).toBeUndefined()
  })

  it('accepts every canonical routing combination without allocating the aggregate runner', () => {
    expect(aggregateSelectors).toHaveLength(13)
    const failures = []
    for (let mask = 0; mask < 2 ** aggregateSelectors.length; mask += 1) {
      const selectors = Object.fromEntries(
        aggregateSelectors.map((job, index) => [job, mask & (1 << index) ? 'true' : 'false'])
      )
      if (admitted(aggregateNeeds('false', selectors))) {
        failures.push(mask)
      }
    }
    expect(failures).toEqual([])
  })

  it('requires each job to match its selected or unselected result', () => {
    for (const job of aggregateRequiredJobs) {
      for (const selected of ['true', 'false']) {
        for (const result of results) {
          const needs = aggregateNeeds(selected)
          needs[job].result = result
          const expected = selected === 'true' ? 'success' : 'skipped'
          expect(admitted(needs), `${job}/${selected}/${result}`).toBe(result !== expected)
        }
      }
    }
  })

  it('requires preflight success if either phase is selected', () => {
    for (const static_analysis of ['true', 'false']) {
      for (const typecheck of ['true', 'false']) {
        for (const result of results) {
          const needs = aggregateNeeds('false', { static_analysis, typecheck })
          needs.preflight.result = result
          const selected = static_analysis === 'true' || typecheck === 'true'
          const expected = selected ? 'success' : 'skipped'
          expect(admitted(needs), `${static_analysis}/${typecheck}/${result}`).toBe(
            result !== expected
          )
        }
      }
    }
  })

  it('sends every malformed selector through the unchanged shell', () => {
    for (const job of aggregateSelectors) {
      for (const selected of malformedSelectors) {
        for (const result of results) {
          const needs = aggregateNeeds('false', { [job]: selected, verify_fast_path: '0' })
          const affected = ['static_analysis', 'typecheck'].includes(job) ? 'preflight' : job
          needs[affected].result = result
          expect(admitted(needs), `${job}/${selected}/${result}`).toBe(true)
        }
      }
    }
  })

  it('rejects outputs masked after the canonical-routing marker was emitted', () => {
    for (const job of aggregateSelectors) {
      for (const selected of ['true', 'false']) {
        for (const masked of ['', undefined, null]) {
          const needs = aggregateNeeds(selected)
          needs.code_paths.outputs[job] = masked
          expect(admitted(needs), `${job}/${selected}/${masked}`).toBe(true)
        }
      }
    }
  })

  it('requires successful detection and a numeric canonical marker', () => {
    for (const selected of ['true', 'false']) {
      for (const result of results) {
        const needs = aggregateNeeds(selected)
        needs.code_paths.result = result
        expect(admitted(needs), `${selected}/${result}`).toBe(result !== 'success')
      }
      for (const marker of ['', '0', 'true', 'TRUE', 'unknown', undefined, null]) {
        expect(admitted(aggregateNeeds(selected, { verify_fast_path: marker }))).toBe(true)
      }
      const missing = aggregateNeeds(selected)
      delete missing.code_paths.outputs
      expect(admitted(missing)).toBe(true)
      delete missing.code_paths
      expect(admitted(missing)).toBe(true)
    }
  })

  it('preserves workflow cancellation while detecting individually cancelled dependencies', () => {
    for (const job of aggregateJob.needs) {
      for (const result of results) {
        const needs = aggregateNeeds()
        needs[job].result = result
        expect(admitted(needs, true), `${job}/${result}`).toBe(false)
        if (result === 'cancelled') {
          expect(admitted(needs, false), job).toBe(true)
        }
      }
      const missing = aggregateNeeds()
      delete missing[job]
      expect(admitted(missing, false), job).toBe(true)
      expect(admitted(missing, true), job).toBe(false)
    }
  })

  it('keeps the informational overall selector independent of the gate', () => {
    for (const should_run of ['true', 'false', ...malformedSelectors]) {
      for (const selected of ['true', 'false']) {
        expect(admitted(aggregateNeeds(selected, { should_run }))).toBe(false)
      }
    }
  })

  it('uses Actions case-insensitive equality and preserves readiness output masking', () => {
    const compare = compileAggregateExpression("needs.value == 'true'")
    expect(compare({ needs: { value: 'TRUE' } }).coerceString()).toBe('true')
    for (const job of aggregateSelectors) {
      const effective = compileAggregateExpression(aggregateMarker.env[aggregateVariable(job)], [
        'steps'
      ])
      for (const reused of ['true', 'TRUE', 'false', '', undefined]) {
        for (const selected of ['true', 'false', ...malformedSelectors]) {
          const context = {
            steps: { readiness: { outputs: { reused } }, filter: { outputs: { [job]: selected } } }
          }
          const masked = reused?.toLowerCase() === 'true'
          expect(effective(context).coerceString(), `${job}/${reused}/${selected}`).toBe(
            masked ? 'false' : (selected ?? '')
          )
        }
      }
    }
  })
})
