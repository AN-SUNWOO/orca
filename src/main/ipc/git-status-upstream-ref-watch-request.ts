import type { Store } from '../persistence'
import { resolveGitStatusUpstreamRef } from '../git/status-upstream-ref'
import { gitExecFileAsync } from '../git/runner'
import { resolveRegisteredWorktreePath } from './registered-worktree-roots-cache'
import {
  getLocalGitOptionsForRepo,
  getLocalRepoForRegisteredWorktree
} from './local-worktree-runtime-options'
import { setWorktreeGitStatusRefWatch } from './worktree-base-directory-watcher'
import type { GitStatusRefBindingRequest } from './worktree-git-status-ref-watch'
import { requireReachableGitRoute } from '../providers/execution-host-provider-dispatch'
import { getConnectionExecutionHostId } from '../../shared/execution-host'

export type GitStatusUpstreamRefWatchRequest = GitStatusRefBindingRequest

const UPSTREAM_REF_RESOLUTION_TIMEOUT_MS = 15_000

function boundedSignal(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(UPSTREAM_REF_RESOLUTION_TIMEOUT_MS)])
}

export function applyGitStatusUpstreamRefWatchRequest(
  store: Store,
  args: GitStatusUpstreamRefWatchRequest
): Promise<void> {
  return setWorktreeGitStatusRefWatch(args, async (bindingSignal) => {
    if (!args.branch || !args.upstreamName) {
      return undefined
    }
    const signal = boundedSignal(bindingSignal)
    requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))

    const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
    const repo = getLocalRepoForRegisteredWorktree(store, args.worktreePath, worktreePath)
    const gitOptions = getLocalGitOptionsForRepo(store, repo)
    return resolveGitStatusUpstreamRef(
      (gitArgs, cwd, requestSignal) =>
        gitExecFileAsync(gitArgs, {
          cwd,
          signal: requestSignal,
          timeout: UPSTREAM_REF_RESOLUTION_TIMEOUT_MS,
          ...(gitOptions.wslDistro ? { wslDistro: gitOptions.wslDistro } : {})
        }),
      worktreePath,
      args.branch,
      args.upstreamName,
      signal
    )
  })
}
