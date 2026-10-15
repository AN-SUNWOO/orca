import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { expect, it } from 'vitest'
import { parse } from 'yaml'
import { classifyPrJobs } from './pr-code-change-scope.mjs'

function workflow(name) {
  return parse(
    readFileSync(join(import.meta.dirname, '../../.github/workflows', `${name}.yml`), 'utf8')
  )
}

it.each([
  'config/node-runtime-patches/darwin-worker-wait.patch',
  'config/scripts/build-darwin-terminal-node.mjs',
  'config/scripts/verify-darwin-terminal-node.mjs',
  'config/scripts/darwin-terminal-node-probe.cjs',
  'config/scripts/__fixtures__/darwin-threadpool-wait.h',
  'config/scripts/macos-terminal-host-bundle.cjs',
  'src/shared/node-runtime-pin.ts'
])('qualifies the actual macOS runtime when %s changes', (file) => {
  expect(classifyPrJobs([file]).darwin_terminal_node).toBe(true)
})

it('does not source-build Node for unrelated renderer changes', () => {
  expect(classifyPrJobs(['src/renderer/src/App.tsx']).darwin_terminal_node).toBe(false)
})

it.each(['adhoc', 'daily', 'hourly', 'release'])(
  'builds both %s runtime architectures after installing build dependencies',
  (channel) => {
    const jobs = Object.values(workflow(`${channel}-mac-build`).jobs)
    const steps = jobs.find((job) =>
      job.steps?.some((step) => step.name === 'Build the patched terminal runtimes')
    ).steps
    const build = steps.findIndex((step) => step.name === 'Build the patched terminal runtimes')
    expect(build).toBeGreaterThan(steps.findIndex((step) => step.name === 'Install dependencies'))
    expect(steps[build].run).toContain('build-darwin-terminal-node.mjs arm64')
    expect(steps[build].run).toContain('build-darwin-terminal-node.mjs x64')
    if (channel === 'daily') {
      expect(steps[build].if).toBe("steps.freshness.outputs.should_build == 'true'")
    }
  }
)

it.skipIf(process.platform === 'win32').each([
  ['success', 'true', 0],
  ['failure', 'true', 1],
  ['cancelled', 'true', 1],
  ['skipped', 'true', 1],
  ['', 'true', 1],
  ['skipped', 'false', 0]
])('aggregate handles runtime result %s (required=%s)', async (result, required, code) => {
  const gate = workflow('pr').jobs.verify.steps.find(
    (step) => step.name === 'Require successful checks'
  )
  const env = Object.fromEntries(
    Object.keys(gate.env).map((key) => [key, key.endsWith('_SHOULD_RUN') ? 'true' : 'success'])
  )
  const checked = await runProcess({
    program: 'bash',
    args: ['-c', gate.run],
    env: {
      ...process.env,
      ...env,
      SHOULD_RUN: 'true',
      DARWIN_TERMINAL_NODE: result,
      DARWIN_TERMINAL_NODE_SHOULD_RUN: required
    },
    timeoutMs: 10_000
  })
  expect(checked.code).toBe(code)
})
