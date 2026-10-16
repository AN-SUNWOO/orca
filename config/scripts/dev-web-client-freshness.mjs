import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const TEST_SOURCE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/

function latestSourceMtimeMs(targetPath) {
  let stat
  try {
    stat = statSync(targetPath)
  } catch {
    return 0
  }
  if (!stat.isDirectory()) {
    return stat.mtimeMs
  }
  let latest = stat.mtimeMs
  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name.startsWith('.') ||
      (!entry.isDirectory() && TEST_SOURCE_PATTERN.test(entry.name))
    ) {
      continue
    }
    latest = Math.max(latest, latestSourceMtimeMs(join(targetPath, entry.name)))
  }
  return latest
}

export function isDevWebClientFresh(root) {
  let outputMtime
  try {
    outputMtime = statSync(join(root, 'out', 'web', 'web-index.html')).mtimeMs
  } catch {
    return false
  }
  if (outputMtime === 0) {
    return false
  }
  // Directory timestamps still invalidate added/deleted sources conservatively.
  const sourceMtime = Math.max(
    latestSourceMtimeMs(join(root, 'vite.web.config.ts')),
    latestSourceMtimeMs(join(root, 'src', 'renderer')),
    latestSourceMtimeMs(join(root, 'src', 'shared')),
    latestSourceMtimeMs(join(root, 'src', 'preload', 'api-types.ts'))
  )
  return sourceMtime <= outputMtime
}
