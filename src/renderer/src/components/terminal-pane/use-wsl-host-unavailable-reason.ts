import { parseExecutionHostId } from '../../../../shared/execution-host'
import { isWslHostRuntimeEnvironment } from '../../../../shared/runtime-environments'
import { workspaceOwnerHostId } from '@/hooks/ipc-events/wsl-host-ipc-bridge'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'

export type WslHostUnavailableReason = 'turned-off' | 'server-files-missing'

/** Why the WSL host owning this workspace cannot run, or null when it can (or is no WSL host). */
export function selectWslHostUnavailableReason(
  state: AppState,
  worktreeId: string | null | undefined
): WslHostUnavailableReason | null {
  if (!worktreeId) {
    return null
  }
  const host = parseExecutionHostId(workspaceOwnerHostId(state, worktreeId))
  const environment =
    host?.kind === 'runtime'
      ? state.runtimeEnvironments.find((candidate) => candidate.id === host.environmentId)
      : undefined
  if (!environment || !isWslHostRuntimeEnvironment(environment)) {
    return null
  }
  if (state.wslHostServerFiles === 'missing') {
    return 'server-files-missing'
  }
  return state.settings?.experimentalWslHosts === true ? null : 'turned-off'
}

export function useWslHostUnavailableReason(
  worktreeId: string | null | undefined
): WslHostUnavailableReason | null {
  return useAppStore((state) => selectWslHostUnavailableReason(state, worktreeId))
}
