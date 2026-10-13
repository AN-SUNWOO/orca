import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parse } from 'yaml'

it('reuses compiler state without skipping validation, and seeds it from main', () => {
  const workflow = parse(readFileSync('.github/workflows/mobile.yml', 'utf8'))
  for (const job of [workflow.jobs.verify, workflow.jobs['main-tests']]) {
    expect(job.env.ORCA_MOBILE_TYPECHECK_CACHE_DIR).toBe(
      '${{ github.workspace }}/mobile/.cache/typechecks'
    )
    const steps = job.steps
    const cache = steps.find((step) => step.name === 'Cache mobile typecheck state')
    expect(cache.uses).toBe('actions/cache@v5')
    expect(cache.with.path).toBe('mobile/.cache/typechecks/*.tsbuildinfo')
    expect(cache.with.key).toBe(`${cache.with['restore-keys']}${'${{ github.sha }}'}`)
    for (const input of [
      'runner.os',
      'runner.arch',
      'pnpm-lock.yaml',
      'mobile/pnpm-lock.yaml',
      'mobile/tsconfig*.json'
    ]) {
      expect(cache.with['restore-keys']).toContain(input)
    }
    const install = steps.findIndex((step) => step.name === 'Install dependencies')
    const wait = steps.find((step) => step.wait)
    for (const id of ['production-types', 'test-types']) {
      const check = steps.find((step) => step.id === id)
      expect(check.if).toBeUndefined()
      expect(check.background).toBe(true)
      expect(check['continue-on-error']).toBeUndefined()
      expect(steps.indexOf(cache)).toBeGreaterThan(install)
      expect(steps.indexOf(cache)).toBeLessThan(steps.indexOf(check))
      expect(wait.wait).toContain(id)
      expect(steps.indexOf(wait)).toBeGreaterThan(steps.indexOf(check))
    }
    expect(steps.find((step) => step.id === 'production-types').run).toContain(
      '--incremental --tsBuildInfoFile "$ORCA_MOBILE_TYPECHECK_CACHE_DIR/production.tsbuildinfo"'
    )
  }
})
