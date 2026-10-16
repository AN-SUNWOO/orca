import { readFileSync, readdirSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parse } from 'yaml'
import { compileAggregateExpression } from './pr-aggregate-gate-context.mjs'

const workflows = readdirSync('.github/workflows').flatMap((file) => {
  const workflow = parse(readFileSync(`.github/workflows/${file}`, 'utf8'))
  // The LoC reporter updates PR metadata rather than running CI.
  return Object.hasOwn(workflow.on ?? {}, 'pull_request') && file !== 'pr-test-loc.yml'
    ? [{ file, workflow }]
    : []
})

function admitted(condition, draft, needs = {}, eventName = 'pull_request') {
  return (
    compileAggregateExpression(condition ?? 'true', ['github', 'needs', 'inputs'])({
      github: {
        event_name: eventName,
        repository: 'stablyai/orca',
        event: { pull_request: { draft } }
      },
      needs,
      inputs: {}
    }).coerceString() === 'true'
  )
}

it.each(workflows)('$file starts no CI jobs for a draft PR', ({ workflow }) => {
  const needs = Object.fromEntries(
    Object.keys(workflow.jobs).map((id) => [id, { result: 'skipped', outputs: {} }])
  )
  for (const [id, job] of Object.entries(workflow.jobs)) {
    // Jobs without a status function inherit success(), so skipped parents block them.
    if (job.needs && !/\b(?:cancelled|always|success|failure)\(/.test(job.if ?? '')) {
      continue
    }
    expect(admitted(job.if, true, needs), id).toBe(false)
  }
})

it.each(workflows)('$file starts CI when ready and cancels it when drafted', ({ workflow }) => {
  const types = workflow.on.pull_request.types
  expect(types).toEqual(
    expect.arrayContaining([
      'opened',
      'synchronize',
      'reopened',
      'ready_for_review',
      'converted_to_draft'
    ])
  )
  expect(Object.values(workflow.jobs).some((job) => !job.needs && admitted(job.if, false))).toBe(
    true
  )
  const concurrency = workflow.concurrency['cancel-in-progress']
  expect(typeof concurrency === 'boolean' ? concurrency : admitted(concurrency, true)).toBe(true)
})

it.each(workflows)('$file keeps its non-PR entry points eligible', ({ workflow }) => {
  const needs = Object.fromEntries(
    Object.keys(workflow.jobs).map((id) => [id, { result: 'success', outputs: {} }])
  )
  for (const event of Object.keys(workflow.on).filter((name) => name !== 'pull_request')) {
    for (const [id, job] of Object.entries(workflow.jobs)) {
      expect(admitted(job.if, true, needs, event), `${event}/${id}`).toBe(
        admitted(job.if, false, needs, event)
      )
    }
  }
})
