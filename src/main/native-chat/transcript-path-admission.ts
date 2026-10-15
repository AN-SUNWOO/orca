import { isAbsolute, relative, resolve } from 'node:path'
import { isDescendantOrEqual, normalizeExistingPath } from '../ipc/filesystem-path-containment'
import { isWslUncPath } from '../../shared/wsl-paths'
import { needsWslHostResolution } from './host-readable-transcript-path'

/** Account containment must survive symlinks and host-native path translation. */
export async function admitTranscriptPath(root: string, candidate: string) {
  if (!isAbsolute(root) || !isAbsolute(candidate) || isWslUncPath(root) ||
      isWslUncPath(candidate) || needsWslHostResolution(candidate)) {
    return null
  }
  const [canonicalRoot, canonicalCandidate] = await Promise.all([
    normalizeExistingPath(resolve(root)), normalizeExistingPath(resolve(candidate))
  ])
  return isDescendantOrEqual(canonicalCandidate, canonicalRoot)
    ? { path: canonicalCandidate, relativePath: relative(canonicalRoot, canonicalCandidate) }
    : null
}
