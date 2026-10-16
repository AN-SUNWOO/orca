import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import type { SleepingAgentSessionRecord } from '../../../shared/agent-session-resume'
import { makePaneKey } from '../../../shared/stable-pane-id'
import { resumeSleepingAgentSessionsForWorktree } from './resume-sleeping-agent-session'

const initialState = useAppStore.getState()
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const HOST_TAB_ID = 'web-terminal-host-tab'

afterEach(() => useAppStore.setState(initialState, true))

function makeRecord(
  worktreeId: string,
  paneKey: string,
  tabId?: string
): SleepingAgentSessionRecord {
  return {
    paneKey,
    ...(tabId ? { tabId } : {}),
    worktreeId,
    agent: 'claude',
    providerSession: { key: 'session_id', id: 'host-conversation' },
    origin: 'live',
    state: 'working',
    prompt: 'continue',
    capturedAt: 1,
    updatedAt: 1
  }
}

describe.each(['repo-1::/workspace/repo', 'folder:workspace'])('%s', (worktreeId) => {
  it.each([
    { paneKey: makePaneKey(HOST_TAB_ID, LEAF_ID), tabId: HOST_TAB_ID },
    { paneKey: makePaneKey(HOST_TAB_ID, LEAF_ID), tabId: undefined },
    { paneKey: `${HOST_TAB_ID}:0`, tabId: undefined }
  ])('preserves an absent host record $paneKey without a catalog owner', ({ paneKey, tabId }) => {
    const record = makeRecord(worktreeId, paneKey, tabId)
    useAppStore.setState({
      tabsByWorktree: { [worktreeId]: [] },
      sleepingAgentSessionsByPaneKey: { [paneKey]: record },
      automaticAgentResumeClaimsByTabId: {},
      pendingStartupByTabId: {}
    })

    expect(resumeSleepingAgentSessionsForWorktree(worktreeId)).toBe(0)
    expect(resumeSleepingAgentSessionsForWorktree(worktreeId)).toBe(0)

    const state = useAppStore.getState()
    expect(state.tabsByWorktree[worktreeId]).toEqual([])
    expect(state.sleepingAgentSessionsByPaneKey[paneKey]).toBe(record)
    expect(state.automaticAgentResumeClaimsByTabId).toEqual({})
    expect(state.pendingStartupByTabId).toEqual({})
  })

  it('still recovers an ordinary terminal record with no preserved tab', () => {
    const record = makeRecord(worktreeId, makePaneKey('local-tab', LEAF_ID), 'local-tab')
    useAppStore.setState({
      tabsByWorktree: { [worktreeId]: [] },
      sleepingAgentSessionsByPaneKey: { [record.paneKey]: record },
      automaticAgentResumeClaimsByTabId: {},
      pendingStartupByTabId: {}
    })

    expect(resumeSleepingAgentSessionsForWorktree(worktreeId)).toBe(1)
    const state = useAppStore.getState()
    expect(state.tabsByWorktree[worktreeId]).toHaveLength(1)
    expect(state.sleepingAgentSessionsByPaneKey[record.paneKey]).toBeUndefined()
    expect(Object.keys(state.automaticAgentResumeClaimsByTabId)).toHaveLength(1)
  })

  it('still clears completed mirror history whose pane is gone', () => {
    const record = {
      ...makeRecord(worktreeId, makePaneKey(HOST_TAB_ID, LEAF_ID), HOST_TAB_ID),
      state: 'done' as const
    }
    useAppStore.setState({
      tabsByWorktree: { [worktreeId]: [] },
      sleepingAgentSessionsByPaneKey: { [record.paneKey]: record },
      automaticAgentResumeClaimsByTabId: {},
      pendingStartupByTabId: {}
    })

    expect(resumeSleepingAgentSessionsForWorktree(worktreeId)).toBe(0)
    const state = useAppStore.getState()
    expect(state.sleepingAgentSessionsByPaneKey).toEqual({})
    expect(state.tabsByWorktree[worktreeId]).toEqual([])
    expect(state.pendingStartupByTabId).toEqual({})
  })

  it('still recovers the newer native record and clears its older mirror duplicate', () => {
    const mirrored = makeRecord(worktreeId, makePaneKey(HOST_TAB_ID, LEAF_ID), HOST_TAB_ID)
    const native = {
      ...makeRecord(worktreeId, makePaneKey('native-tab', LEAF_ID), 'native-tab'),
      capturedAt: 2,
      updatedAt: 2
    }
    useAppStore.setState({
      tabsByWorktree: { [worktreeId]: [] },
      sleepingAgentSessionsByPaneKey: {
        [mirrored.paneKey]: mirrored,
        [native.paneKey]: native
      },
      automaticAgentResumeClaimsByTabId: {},
      pendingStartupByTabId: {}
    })

    expect(resumeSleepingAgentSessionsForWorktree(worktreeId)).toBe(1)
    expect(resumeSleepingAgentSessionsForWorktree(worktreeId)).toBe(0)
    const state = useAppStore.getState()
    expect(state.sleepingAgentSessionsByPaneKey).toEqual({})
    expect(state.tabsByWorktree[worktreeId]).toHaveLength(1)
    expect(Object.values(state.automaticAgentResumeClaimsByTabId)).toMatchObject([
      { providerSession: native.providerSession }
    ])
    expect(Object.values(state.pendingStartupByTabId)).toMatchObject([
      { resumeProviderSession: native.providerSession }
    ])
  })
})
