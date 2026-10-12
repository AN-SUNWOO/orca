import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runProcess } from '@orca/process-host'

export type ServeInstallEvidence =
  | { kind: 'clear' }
  | { kind: 'hold'; reason: 'bundle-missing' | 'installer-running' | 'installer-unknown' }

export const SERVE_INSTALL_HOLD_REASON_TEXT: Record<
  Extract<ServeInstallEvidence, { kind: 'hold' }>['reason'],
  string
> = {
  'bundle-missing': 'the Orca executable is missing, likely mid-install',
  'installer-running': "macOS's updater (ShipIt) is replacing this Orca app",
  'installer-unknown': "could not check whether macOS's updater (ShipIt) is replacing this Orca app"
}

type ListProcesses = () => Promise<string | null>

/** `ps` is one short-lived fork with no interpreter; a failure is reported as unknown, not clear. */
const listProcessCommands: ListProcesses = async () => {
  try {
    const result = await runProcess({
      program: '/bin/ps',
      args: ['-axww', '-o', 'command='],
      timeoutMs: 5_000,
      maxOutputBytes: 8 * 1024 * 1024,
      killOnOutputLimit: true
    })
    return result.code === 0 && !result.timedOut && !result.outputTruncated ? result.stdout : null
  } catch {
    return null
  }
}

/** ShipIt runs from inside the bundle it replaces, so its command line names that bundle. */
export function isShipItRunningForBundle(listing: string, bundlePath: string): boolean {
  const prefix = `${join(bundlePath, 'Contents', 'Frameworks', 'Squirrel.framework')}/`
  return listing.split('\n').some((line) => {
    const command = line.trimStart()
    return (
      command.startsWith(prefix) && command.slice(prefix.length).split(' ')[0].endsWith('/ShipIt')
    )
  })
}

/**
 * Whether a supervised serve may spawn from `executable` right now. Never spawn from a bundle an
 * installer is swapping: the child would run half-old, half-new code or be killed mid-start.
 */
export async function readServeInstallEvidence(
  executable: string,
  options: { platform?: NodeJS.Platform; listProcesses?: ListProcesses } = {}
): Promise<ServeInstallEvidence> {
  const platform = options.platform ?? process.platform
  const bundlePath = platform === 'darwin' ? macBundlePathOf(executable) : null
  // Why ShipIt first: mid-swap the executable is briefly missing, and that must not look like removal.
  if (bundlePath) {
    const listing = await (options.listProcesses ?? listProcessCommands)()
    if (listing === null) {
      return { kind: 'hold', reason: 'installer-unknown' }
    }
    if (isShipItRunningForBundle(listing, bundlePath)) {
      return { kind: 'hold', reason: 'installer-running' }
    }
  }
  return existsSync(executable) ? { kind: 'clear' } : { kind: 'hold', reason: 'bundle-missing' }
}

function macBundlePathOf(executable: string): string | null {
  const bundle = dirname(dirname(dirname(executable)))
  return bundle.endsWith('.app') ? bundle : null
}

/**
 * Changes whenever the installed app does, so a new build starts with a clean restart count. The
 * app archive is included because Linux releases on one Electron version share the launcher binary.
 */
export function serveBuildIdentity(executable: string, appRoot?: string): string {
  return [executable, ...(appRoot ? [appRoot] : [])]
    .map((path) => {
      try {
        const stat = statSync(path)
        return `${stat.size}:${Math.trunc(stat.mtimeMs)}`
      } catch {
        return 'missing'
      }
    })
    .join('|')
}
