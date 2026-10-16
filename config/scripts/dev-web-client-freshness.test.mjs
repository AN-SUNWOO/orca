import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { isDevWebClientFresh } from './dev-web-client-freshness.mjs'

const roots = []
const OLD = new Date(Date.now() - 120_000)
const BUILT = new Date(Date.now() - 60_000)
const EDITED = new Date()

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orca-dev-web-freshness-'))
  roots.push(root)
  const files = [
    'vite.web.config.ts',
    'src/renderer/src/app.tsx',
    'src/renderer/src/app.test.tsx',
    'src/renderer/src/app.spec.ts',
    'src/renderer/src/main.css',
    'src/shared/value.ts',
    'src/shared/value.test.ts',
    'src/preload/api-types.ts',
    'out/web/web-index.html'
  ]
  const directories = new Set()
  for (const file of files) {
    const absolute = join(root, file)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, '')
    utimesSync(absolute, OLD, OLD)
    for (let directory = dirname(absolute); directory !== root; directory = dirname(directory)) {
      directories.add(directory)
    }
  }
  for (const directory of directories) {
    utimesSync(directory, OLD, OLD)
  }
  utimesSync(join(root, 'out/web/web-index.html'), BUILT, BUILT)
  return root
}

it('requires a web bundle before declaring it fresh', () => {
  const root = fixture()
  expect(isDevWebClientFresh(root)).toBe(true)
  rmSync(join(root, 'out/web/web-index.html'))
  expect(isDevWebClientFresh(root)).toBe(false)
})

it('keeps an existing bundle fresh after editing renderer or shared tests', () => {
  const root = fixture()
  for (const file of [
    'src/renderer/src/app.test.tsx',
    'src/renderer/src/app.spec.ts',
    'src/shared/value.test.ts'
  ]) {
    writeFileSync(join(root, file), 'changed test')
    utimesSync(join(root, file), EDITED, EDITED)
  }
  expect(isDevWebClientFresh(root)).toBe(true)
})

it.each([
  'src/renderer/src/app.tsx',
  'src/renderer/src/main.css',
  'src/shared/value.ts',
  'src/preload/api-types.ts',
  'vite.web.config.ts'
])('rebuilds when %s changes', (file) => {
  const root = fixture()
  utimesSync(join(root, file), EDITED, EDITED)
  expect(isDevWebClientFresh(root)).toBe(false)
})

it.each(['add', 'delete'])('rebuilds after a production source %s', (operation) => {
  const root = fixture()
  const file = join(root, 'src/renderer/src/app.tsx')
  if (operation === 'delete') {
    rmSync(file)
  } else {
    writeFileSync(join(root, 'src/renderer/src/new.tsx'), '')
  }
  utimesSync(dirname(file), EDITED, EDITED)
  expect(isDevWebClientFresh(root)).toBe(false)
})
