import { readGitCommandFailureText } from '../git-command-failure-text'

// Why: non-force `git worktree remove` refuses every initialized submodule (Git >= 2.17), clean or not.
// Callers re-check for uncommitted work and retry with one --force. Git output is pinned to English.
export function isSubmoduleWorktreeRemovalRefusal(error: unknown): boolean {
  return /working trees containing submodules cannot be moved or removed/i.test(
    readGitCommandFailureText(error)
  )
}
