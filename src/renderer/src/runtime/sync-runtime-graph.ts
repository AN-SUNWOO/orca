import type { AppState } from '@/store/types'
import {
  syncRuntimeGraph,
  setTrailingGraphSyncScheduler
} from './sync-runtime-graph/graph-publication'
import { graphState, RUNTIME_GRAPH_SYNC_COALESCE_MS } from './sync-runtime-graph/graph-state'
import { subscribeMountedTerminalTabChanges } from './mounted-terminal-tab-registry'
import {
  AGENT_STATUS_SYNC_UPDATED_AT_BUCKET_MS_FOR_TESTS,
  buildRuntimeMobileAgentStatusProjectionForTests,
  resetRuntimeMobileAgentStatusProjectionCacheForTests
} from './sync-runtime-graph/agent-status-projection'
import {
  canSkipRuntimeMobileSessionSyncKeyBuild,
  getRuntimeMobileSessionSyncKey,
  runtimeMobileSessionSyncKeysEqual
} from './sync-runtime-graph/sync-key'
import { buildMobileSessionTabSnapshots } from './sync-runtime-graph/mobile-session-snapshots'
import { resetRuntimeMobileSyncProjectionCachesForTests } from './sync-runtime-graph/sync-projections'

export type { RuntimeMobileSessionSyncKey } from './sync-runtime-graph/types'
export {
  AGENT_STATUS_SYNC_UPDATED_AT_BUCKET_MS_FOR_TESTS,
  buildRuntimeMobileAgentStatusProjectionForTests,
  resetRuntimeMobileAgentStatusProjectionCacheForTests,
  resetRuntimeMobileSyncProjectionCachesForTests,
  canSkipRuntimeMobileSessionSyncKeyBuild,
  getRuntimeMobileSessionSyncKey,
  runtimeMobileSessionSyncKeysEqual,
  buildMobileSessionTabSnapshots
}

export function setRuntimeGraphStoreStateGetter(getter: (() => AppState) | null): void {
  graphState.getStoreState = getter
}

export function setRuntimeGraphSyncEnabled(enabled: boolean): void {
  graphState.syncEnabled = enabled
  if (!enabled) {
    graphState.syncPendingAfterFlight = false
    clearScheduledRuntimeGraphSync()
    return
  }
  scheduleRuntimeGraphSync()
}

function clearScheduledRuntimeGraphSync(): void {
  if (graphState.syncTimer !== null) {
    clearTimeout(graphState.syncTimer)
    graphState.syncTimer = null
  }
  graphState.syncScheduled = false
}

export function scheduleRuntimeGraphSync(): void {
  if (!graphState.syncEnabled || graphState.syncScheduled) {
    return
  }
  if (graphState.syncInFlight) {
    graphState.syncPendingAfterFlight = true
    return
  }
  graphState.syncScheduled = true
  // Collapse separate title/status tasks into one frame-sized graph publication.
  graphState.syncTimer = setTimeout(() => {
    graphState.syncTimer = null
    graphState.syncScheduled = false
    void runRuntimeGraphSync()
  }, RUNTIME_GRAPH_SYNC_COALESCE_MS)
}

async function runRuntimeGraphSync(): Promise<void> {
  if (graphState.syncInFlight) {
    graphState.syncPendingAfterFlight = true
    return
  }
  graphState.syncInFlight = true
  try {
    await syncRuntimeGraph()
  } finally {
    graphState.syncInFlight = false
    if (graphState.syncPendingAfterFlight) {
      graphState.syncPendingAfterFlight = false
      scheduleRuntimeGraphSync()
    }
  }
}

setTrailingGraphSyncScheduler(scheduleRuntimeGraphSync)
subscribeMountedTerminalTabChanges(scheduleRuntimeGraphSync)
