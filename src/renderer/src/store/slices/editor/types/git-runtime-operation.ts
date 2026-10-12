import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'

export type GitRuntimeOperationOptions = {
  /** The worktree owner's transport; absent resolves it from the worktree's rows. */
  runtimeTarget?: RuntimeClientTarget | null
  applyUpstreamStatus?: boolean
}
