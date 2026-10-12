import type { RuntimeClientTarget } from '../../../../runtime/runtime-rpc-client'
import type { PreservedBranchCleanup } from '../../../../../../shared/preserved-branch-cleanup'

export const preservedBranchRuntimeTargetByCleanupKey = new Map<
  string,
  { cleanup: PreservedBranchCleanup; target: RuntimeClientTarget }
>()
