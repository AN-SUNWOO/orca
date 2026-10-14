import { toast } from 'sonner'
import { useAppStore } from '@/store'
import {
  beginWorktreeSleepTeardown,
  clearWorktreeSleepIntent,
  isCurrentWorktreeSleepIntent,
  markWorktreeSleepIntent,
  withWorktreeSleepTeardown
} from '@/lib/worktree-sleep-intent'
import { preserveSidebarWorktreePosition } from './sleep-worktree-sidebar-position'
import { translate } from '@/i18n/i18n'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import { structuredAgentSessionTargetForHost } from '@/runtime/structured-agent-session-owner'
import {
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { resolveWorktreeOperationRouteResult } from '@/lib/worktree-operation-route'
import { findIndexedFolderWorkspaceOwner } from '@/lib/worktree-runtime-owner-index'
import { getFolderWorkspaceHostId } from './folder-workspace-host-id'
import type { AppState } from '@/store/types'

export type WorkspaceSleepTarget =
  | string
  | {
      id: string
      repoId?: string
      executionHostId?: ExecutionHostId
      hostId?: ExecutionHostId
      runtimeOwnerEnvironmentId?: string
    }

export type WorkspaceSleepResult = {
  workspaceId: string
  executionHostId: ExecutionHostId
  stoppedSessionIds: string[]
  completed: boolean
}

/**
 * Shared "sleep worktree" flow (close all panels to free memory / CPU)
 * used by WorktreeContextMenu and MemoryStatusSegment's per-row hover action.
 *
 * Why this is a module helper rather than inlined at each call site: the guard
 * that clears `activeWorktreeId` before tearing down terminals isn't optional
 * polish — shutting down the active worktree while its TerminalPane is still
 * visible causes a visible "reboot" flicker and can crash the pane (PTY exit
 * callbacks race against the live xterm instance). See the original comment
 * in WorktreeContextMenu's handleCloseTerminals for the full reasoning.
 * Centralizing the sequence here keeps that safety invariant in one place so
 * a new caller can't accidentally skip it.
 */
export async function runSleepWorktree(
  worktreeId: string,
  executionHostId?: ExecutionHostId
): Promise<WorkspaceSleepResult[]> {
  return runSleepWorktrees([executionHostId ? { id: worktreeId, executionHostId } : worktreeId])
}

function describeSleepFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  if (detail.includes('legacy')) {
    return translate(
      'auto.components.sidebar.sleep.worktree.flow.legacy.unverified',
      'The older host runtime could not confirm terminal shutdown. The workspace was kept open; update the host and try again.'
    )
  }
  if (
    detail.includes('terminal_') ||
    detail.includes('runtime') ||
    detail.includes('connection') ||
    detail.includes('Daemon')
  ) {
    return translate(
      'auto.components.sidebar.sleep.worktree.flow.host.unverified',
      'The host could not confirm terminal shutdown. The workspace was kept open; check the connection and try again.'
    )
  }
  return translate(
    'auto.components.sidebar.sleep.worktree.flow.retry',
    'The workspace was kept open. Try again; if the problem continues, check the host connection.'
  )
}

function describeChatStopFailure(): string {
  return translate(
    'auto.components.sidebar.sleep.worktree.flow.chat.partial',
    'The host could not confirm the chat stopped. Other panels may have closed; check the connection and try again.'
  )
}

function resolveSleepTarget(
  state: AppState,
  target: WorkspaceSleepTarget
): { workspaceId: string; executionHostId: ExecutionHostId } | null {
  const workspaceId = typeof target === 'string' ? target : target.id
  const explicit = typeof target === 'string' ? undefined : target.executionHostId
  if (explicit) {
    const host = parseExecutionHostId(explicit)
    return host ? { workspaceId, executionHostId: host.id } : null
  }
  const scope = parseWorkspaceKey(workspaceId)
  if (scope?.type === 'folder') {
    const folder = findIndexedFolderWorkspaceOwner(state.folderWorkspaces, scope.folderWorkspaceId)
    if (!folder) {
      return null
    }
    const group = state.projectGroups.find((candidate) => candidate.id === folder.projectGroupId)
    const executionHostId = getFolderWorkspaceHostId(
      folder,
      group ?? { connectionId: null, executionHostId: null },
      parseExecutionHostId(state.restoredRuntimeHostIdByWorkspaceSessionKey?.[workspaceId])?.id ??
        LOCAL_EXECUTION_HOST_ID
    )
    return { workspaceId, executionHostId }
  }
  if (typeof target !== 'string') {
    const runtimeOwner = target.runtimeOwnerEnvironmentId?.trim()
    if (runtimeOwner) {
      return { workspaceId, executionHostId: toRuntimeExecutionHostId(runtimeOwner) }
    }
    const stamped = parseExecutionHostId(target.hostId)
    if (stamped) {
      return { workspaceId, executionHostId: stamped.id }
    }
  }
  const route = resolveWorktreeOperationRouteResult(state, workspaceId)
  return route.kind === 'resolved' && route.route.executionHostId
    ? { workspaceId, executionHostId: route.route.executionHostId }
    : null
}

export async function runSleepWorktrees(
  targets: readonly WorkspaceSleepTarget[]
): Promise<WorkspaceSleepResult[]> {
  if (targets.length === 0) {
    return []
  }
  const state = useAppStore.getState()
  const errors: string[] = []
  const seen = new Set<string>()
  const resolved = targets.flatMap((target) => {
    const selected = resolveSleepTarget(state, target)
    if (!selected) {
      errors.push(describeSleepFailure(new Error('workspace owner is unavailable')))
      return []
    }
    const key = `${selected.executionHostId}\0${selected.workspaceId}`
    if (seen.has(key)) {
      return []
    }
    seen.add(key)
    return [selected]
  })
  const marked = resolved.map((target) => ({
    ...target,
    token: markWorktreeSleepIntent(target.workspaceId, target.executionHostId)
  }))
  const finishTeardowns = marked.map((target) =>
    beginWorktreeSleepTeardown(target.workspaceId, target.executionHostId)
  )
  const nativeCalls = marked.map(({ workspaceId, executionHostId }) => {
    const nativeTarget = structuredAgentSessionTargetForHost(executionHostId)
    return nativeTarget
      ? callStructuredAgentSession<{ stoppedSessionIds: string[] }>(
          nativeTarget,
          'agentSession.sleepWorkspace',
          { workspaceId }
        ).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      : Promise.resolve({ ok: true as const, value: { stoppedSessionIds: [] } })
  })
  const selected = marked.find(
    (target) =>
      state.activeWorktreeId === target.workspaceId &&
      state.activeWorkspaceExecutionHostId === target.executionHostId
  )
  if (selected) {
    const restoreSidebarPosition = preserveSidebarWorktreePosition(selected.workspaceId)
    state.setActiveWorktree(null)
    restoreSidebarPosition()
  }
  const results = await Promise.all(
    marked.map((target, index) =>
      withWorktreeSleepTeardown(
        target.workspaceId,
        async (): Promise<WorkspaceSleepResult> => {
          const { workspaceId, executionHostId, token } = target
          const current = (): boolean =>
            isCurrentWorktreeSleepIntent(workspaceId, executionHostId, token)
          let stoppedSessionIds: string[] = []
          let nativeCompleted = true
          let panelsCompleted = true
          let terminalsStopped = false
          const native = await nativeCalls[index]
          if (native.ok) {
            stoppedSessionIds = native.value.stoppedSessionIds
          } else {
            console.error('[sleep-worktree] native chat stop failed', {
              workspaceId,
              error: native.error
            })
            nativeCompleted = false
            errors.push(describeChatStopFailure())
          }
          if (current()) {
            try {
              await state.shutdownWorktreeBrowsers(workspaceId)
            } catch (error) {
              console.error('[sleep-worktree] browser shutdown failed', { workspaceId, error })
              panelsCompleted = false
              errors.push(describeSleepFailure(error))
            }
          } else {
            panelsCompleted = false
          }
          if (current() && panelsCompleted) {
            try {
              await state.shutdownWorktreeTerminals(workspaceId, { keepIdentifiers: true })
              terminalsStopped = true
            } catch (error) {
              console.error('[sleep-worktree] terminal shutdown failed', { workspaceId, error })
              panelsCompleted = false
              errors.push(describeSleepFailure(error))
            }
          }
          if (
            current() &&
            terminalsStopped &&
            typeof window !== 'undefined' &&
            window.api?.ephemeralVm?.suspendWorkspace
          ) {
            try {
              await window.api.ephemeralVm.suspendWorkspace({ workspaceId, executionHostId })
            } catch (error) {
              console.error('[sleep-worktree] host suspension failed', { workspaceId, error })
              panelsCompleted = false
              errors.push(describeSleepFailure(error))
            }
          }
          const completed = nativeCompleted && panelsCompleted && terminalsStopped && current()
          if (!completed && !terminalsStopped && current()) {
            clearWorktreeSleepIntent(workspaceId, executionHostId)
          }
          return { workspaceId, executionHostId, stoppedSessionIds, completed }
        },
        target.executionHostId
      )
    )
  ).finally(() => finishTeardowns.forEach((finish) => finish()))
  if (errors.length > 0) {
    toast.error(
      resolved.length === 1
        ? translate(
            'auto.components.sidebar.sleep.worktree.flow.8bc3fc0671',
            'Failed to sleep workspace'
          )
        : translate(
            'auto.components.sidebar.sleep.worktree.flow.c460fecc4a',
            'Failed to sleep some workspaces'
          ),
      { description: [...new Set(errors)].join('\n') }
    )
  }
  return results
}
