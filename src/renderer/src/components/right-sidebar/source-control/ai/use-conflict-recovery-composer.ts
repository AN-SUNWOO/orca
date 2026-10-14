import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import {
  admitSourceControlRecovery,
  sourceControlRecoveryScopeKey
} from '../../source-control-recovery-admission'
import type { SourceControlAiControllerParams } from './controller-types'
import { buildResolveConflictsPrompt } from './prompts'

export function useConflictRecoveryComposer({
  target,
  activeWorktreeId,
  activeConnectionId,
  conflictOperation,
  unresolvedConflicts,
  worktreePath
}: Pick<
  SourceControlAiControllerParams,
  | 'target'
  | 'activeWorktreeId'
  | 'activeConnectionId'
  | 'conflictOperation'
  | 'unresolvedConflicts'
  | 'worktreePath'
>) {
  const context = useMemo(
    () =>
      target && activeWorktreeId && worktreePath
        ? {
            target,
            worktreeId: activeWorktreeId,
            worktreePath,
            connectionId: activeConnectionId ?? undefined
          }
        : null,
    [target, activeWorktreeId, activeConnectionId, worktreePath]
  )
  const scope = context ? sourceControlRecoveryScopeKey(context) : null
  const currentScopeRef = useRef(scope)
  const checkingScopesRef = useRef(new Set<string>())
  const [openScope, setOpenScope] = useState<string | null>(null)
  const [checkingScope, setCheckingScope] = useState<string | null>(null)
  useEffect(() => {
    currentScopeRef.current = scope
    return () => {
      currentScopeRef.current = null
    }
  }, [scope])

  const resolveConflictsPrompt = useMemo(
    () =>
      buildResolveConflictsPrompt({
        conflictOperation,
        entries: unresolvedConflicts,
        worktreePath
      }),
    [conflictOperation, unresolvedConflicts, worktreePath]
  )
  const setResolveConflictsComposerOpen = useCallback(
    (open: boolean): void => {
      setOpenScope(open ? scope : null)
    },
    [scope]
  )
  const handleResolveConflictsWithAI = useCallback(async (): Promise<void> => {
    if (
      !context ||
      !scope ||
      currentScopeRef.current !== scope ||
      checkingScopesRef.current.has(scope)
    ) {
      return
    }
    if (unresolvedConflicts.length === 0 && conflictOperation === 'unknown') {
      toast.message(
        translate(
          'auto.components.right.sidebar.use.source.control.ai.cfafa92509',
          'No unresolved conflicts to send.'
        )
      )
      return
    }
    checkingScopesRef.current.add(scope)
    setCheckingScope(scope)
    try {
      if ((await admitSourceControlRecovery(context)) && currentScopeRef.current === scope) {
        setOpenScope(scope)
      }
    } finally {
      checkingScopesRef.current.delete(scope)
      setCheckingScope((current) => (current === scope ? null : current))
    }
  }, [context, scope, conflictOperation, unresolvedConflicts.length])

  return {
    resolveConflictsPrompt,
    resolveConflictsRecoveryContext: context,
    resolveConflictsComposerOpen: scope !== null && openScope === scope,
    isCheckingRecoveryAdmission: scope !== null && checkingScope === scope,
    setResolveConflictsComposerOpen,
    handleResolveConflictsWithAI
  }
}
