import { SUBMODULE_DIRTY_REMOVAL_DETAIL } from '../../shared/worktree/removal'
import { gitExecFileAsync } from './runner'
import type { WorktreeRemovalPreflightOptions } from './worktree-operation-options'
import { WORKTREE_REMOVAL_PREFLIGHT_TIMEOUT_MS, gitExecOptions } from './worktree-operation-options'

/**
 * Assert a worktree is clean enough for non-force removal.
 */
export async function assertWorktreeCleanForRemoval(
  worktreePath: string,
  force = false,
  options: WorktreeRemovalPreflightOptions = {}
): Promise<void> {
  if (force) {
    return
  }

  const { ignoredUntrackedPaths = [], ...gitOptions } = options
  const useNullTerminatedStatus = ignoredUntrackedPaths.length > 0
  const { stdout } = await gitExecFileAsync(
    [
      'status',
      '--porcelain',
      ...(useNullTerminatedStatus ? ['-z'] : []),
      '--untracked-files=all',
      // Why: a user's ignore-submodules setting would hide submodule edits from this dirty check.
      '--ignore-submodules=none'
    ],
    {
      ...gitExecOptions(worktreePath, gitOptions),
      timeout: gitOptions.timeout ?? WORKTREE_REMOVAL_PREFLIGHT_TIMEOUT_MS
    }
  )
  // Why one parse feeds both: the clean verdict and the error text must never
  // disagree about which entries block removal.
  const blockingEntries = useNullTerminatedStatus
    ? getBlockingUntrackedStatusEntries(stdout, ignoredUntrackedPaths)
    : null
  if (blockingEntries ? blockingEntries.length === 0 : !stdout.trim()) {
    return
  }

  const entries = blockingEntries ?? stdout.split('\n').filter(Boolean)
  if (
    entries.some((entry) => !entry.startsWith('??')) &&
    (await hasChangedSubmodule(worktreePath, gitOptions))
  ) {
    // Why no status lines: Force Delete here also destroys never-pushed submodule commits, so the
    // refusal must say submodules; the detail still reads as dirty to older classifiers.
    throw new Error(SUBMODULE_DIRTY_REMOVAL_DETAIL)
  }

  const error = new Error('Worktree has uncommitted or untracked changes.')
  // Why not the raw stdout: `-z` output is NUL-delimited and `.trim()` leaves
  // interior NULs, so attaching it verbatim put raw control bytes into the
  // user-facing removal error — and listed the tolerated shared link, the one
  // entry that is not the user's work and cannot be committed away.
  ;(error as Error & { stdout?: string }).stdout = blockingEntries
    ? blockingEntries.join('\n')
    : stdout
  throw error
}

/** Porcelain v1 cannot tell a submodule from a file; v2 marks one with an `S...` field. */
async function hasChangedSubmodule(
  worktreePath: string,
  gitOptions: Omit<WorktreeRemovalPreflightOptions, 'ignoredUntrackedPaths'>
): Promise<boolean> {
  try {
    const { stdout } = await gitExecFileAsync(
      ['status', '--porcelain=v2', '--untracked-files=no', '--ignore-submodules=none'],
      {
        ...gitExecOptions(worktreePath, gitOptions),
        timeout: gitOptions.timeout ?? WORKTREE_REMOVAL_PREFLIGHT_TIMEOUT_MS
      }
    )
    return /^[12u] \S\S S/m.test(stdout)
  } catch {
    // The plain dirty refusal still blocks the delete; only its wording is lost.
    return false
  }
}

/** The `git status --porcelain -z` entries that genuinely block removal:
 *  everything except the untracked shared links the caller tolerates. */
function getBlockingUntrackedStatusEntries(
  status: string,
  ignoredUntrackedPaths: readonly string[]
): string[] {
  const ignored = new Set(
    ignoredUntrackedPaths
      .map((entry) =>
        entry
          .trim()
          .replace(/^[\\/]+/, '')
          .replace(/\\/g, '/')
      )
      .filter((entry) => entry && !entry.split('/').includes('..'))
  )
  return status
    .split('\0')
    .filter(Boolean)
    .filter(
      (entry) => !(entry.startsWith('?? ') && ignored.has(entry.slice(3).replace(/\\/g, '/')))
    )
}
