import { describe, expect, it } from 'vitest'
import { assessCompatBoundaryImports } from './check-compat-boundary-imports.mjs'

const folders = [
  { folder: 'src/main/compat', importers: ['src/main/owner.ts'] },
  { folder: 'src/renderer/src/runtime/frozen', importers: [] }
]

function assess(files) {
  return assessCompatBoundaryImports(new Map(Object.entries(files)), folders)
}

describe('compatibility folder import boundary', () => {
  it('lets the named importer use the entry and the folder use itself', () => {
    expect(
      assess({
        'src/main/owner.ts': "import { a } from './compat'\nimport { b } from './compat/index.ts'",
        'src/main/compat/index.ts': "export { a } from './a'",
        'src/main/compat/a.test.ts': "import { a } from './a'"
      })
    ).toEqual([])
  })

  it('rejects other importers and deep imports, including renderer aliases', () => {
    expect(
      assess({
        'src/main/other.ts': "import { a } from './compat'",
        'src/main/owner.ts': "import { a } from './compat/a'",
        'src/renderer/src/store.ts': "import { f } from '@/runtime/frozen'"
      })
    ).toEqual([
      'src/main/other.ts: only src/main/owner.ts may import src/main/compat',
      'src/main/owner.ts: import src/main/compat through its index, not ./compat/a',
      'src/renderer/src/store.ts: only no file may import src/renderer/src/runtime/frozen'
    ])
  })

  it('resolves renderer aliases only in renderer files', () => {
    expect(assess({ 'mobile/src/app.ts': "import { f } from '@/runtime/frozen'" })).toEqual([])
  })

  it('lets tests outside the folder use only the entry', () => {
    expect(
      assess({
        'src/main/owner.test.ts': "import { a } from './compat'",
        'src/main/other.test.ts': "import { a } from './compat/a'"
      })
    ).toEqual(['src/main/other.test.ts: import src/main/compat through its index, not ./compat/a'])
  })
})
