/** Process-wide stop and spawn gate for `orca serve --supervise`, shared with the update loop. */
let supervisedStopRequested = false
let supervisedStop = new AbortController()
let supervisedSpawnGate: (() => Promise<boolean>) | null = null

/** A stop that reached `--supervise` before its child existed must still reach that child. */
export function requestSupervisedServeStop(): void {
  supervisedStopRequested = true
  supervisedStop.abort()
}

/** Starts a supervised run: `gate` resolves true when a replacement may spawn, false on stop. */
export function resetSupervisedServeStop(gate: (() => Promise<boolean>) | null = null): void {
  supervisedStopRequested = false
  supervisedStop = new AbortController()
  supervisedSpawnGate = gate
}

/** Why: update replacements spawn inside this loop, so the install hold must gate them too. */
export async function mayRespawn(): Promise<boolean> {
  if (supervisedStopRequested) {
    return false
  }
  return supervisedSpawnGate ? supervisedSpawnGate() : true
}

export function isSupervisedStopRequested(): boolean {
  return supervisedStopRequested
}

export function supervisedStopSignal(): AbortSignal {
  return supervisedStop.signal
}
