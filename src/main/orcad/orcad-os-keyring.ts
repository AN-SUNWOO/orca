/**
 * The OS keyring orcad keeps its master key in, when the host has one it can reach.
 *
 * macOS: the login Keychain through `/usr/bin/security`. Linux: the Secret Service through
 * `secret-tool`, only with a session bus (a bare SSH login has none, and dbus autolaunch can
 * hang). Windows: none — DPAPI needs PowerShell or a native addon, and per-operation
 * PowerShell is an EDR signal (see AGENTS.md), so Windows uses the profile key file.
 */
import { runProcess } from '@orca/process-host'
import type { ProcessResult, ProcessSpec } from '@orca/process-host/process-spec'

const SERVICE = 'orca-headless-secret-store'
const KEYRING_TIMEOUT_MS = 5_000
const MAX_OUTPUT_BYTES = 4096

export type OrcadKeyringRunner = (spec: ProcessSpec) => Promise<ProcessResult>

/** `missing`: the keyring answered and has no item. `unreachable`: absent, locked, or timed out. */
export type OrcadKeyringLookup =
  | { kind: 'found'; value: string }
  | { kind: 'missing' }
  | { kind: 'unreachable'; reason: string }

export type OrcadOsKeyring = {
  label: string
  lookup(account: string): Promise<OrcadKeyringLookup>
  /** Resolves true only when the keyring reports success; callers still read the item back. */
  store(account: string, value: string): Promise<boolean>
}

function describeFailure(result: ProcessResult): string {
  if (result.timedOut) {
    return `timed out after ${KEYRING_TIMEOUT_MS / 1000}s`
  }
  // Why the first line only: stderr is diagnostics, never the secret (it travels on stdin).
  const detail = result.stderr.trim().split('\n')[0]?.slice(0, 200)
  return detail ? `exited ${result.code}: ${detail}` : `exited ${result.code}`
}

async function run(runner: OrcadKeyringRunner, spec: ProcessSpec): Promise<ProcessResult | string> {
  try {
    return await runner({
      ...spec,
      timeoutMs: KEYRING_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES
    })
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function macosKeychain(runner: OrcadKeyringRunner): OrcadOsKeyring {
  const program = '/usr/bin/security'
  return {
    label: 'the macOS Keychain',
    async lookup(account) {
      const result = await run(runner, {
        program,
        args: ['find-generic-password', '-s', SERVICE, '-a', account, '-w']
      })
      if (typeof result === 'string') {
        return { kind: 'unreachable', reason: result }
      }
      if (result.code === 0 && result.stdout.trim()) {
        return { kind: 'found', value: result.stdout.trim() }
      }
      // errSecItemNotFound.
      return result.code === 44
        ? { kind: 'missing' }
        : { kind: 'unreachable', reason: describeFailure(result) }
    },
    async store(account, value) {
      // Why `security -i` over stdin: `-w <value>` on argv is visible to every user in `ps`.
      // Why no -U: an item that already exists must never be replaced under a sealed record.
      const result = await run(runner, {
        program,
        args: ['-i'],
        input: `add-generic-password -s ${SERVICE} -a ${account} -w ${value}\n`
      })
      return typeof result !== 'string' && result.code === 0 && !result.timedOut
    }
  }
}

function linuxSecretService(runner: OrcadKeyringRunner): OrcadOsKeyring {
  const attributes = (account: string): string[] => ['service', SERVICE, 'account', account]
  return {
    label: 'the Secret Service keyring',
    async lookup(account) {
      const result = await run(runner, {
        program: 'secret-tool',
        args: ['lookup', ...attributes(account)]
      })
      if (typeof result === 'string') {
        return { kind: 'unreachable', reason: result }
      }
      if (result.code === 0 && result.stdout.trim()) {
        return { kind: 'found', value: result.stdout.trim() }
      }
      // Why: secret-tool exits 1 silently for "no such item" and prints a reason otherwise.
      return result.code === 1 && !result.stderr.trim() && !result.timedOut
        ? { kind: 'missing' }
        : { kind: 'unreachable', reason: describeFailure(result) }
    },
    async store(account, value) {
      const result = await run(runner, {
        program: 'secret-tool',
        args: ['store', '--label', 'Orca headless server secret key', ...attributes(account)],
        input: value
      })
      return typeof result !== 'string' && result.code === 0 && !result.timedOut
    }
  }
}

export function resolveOrcadOsKeyring(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  runner: OrcadKeyringRunner = runProcess
): OrcadOsKeyring | null {
  if (platform === 'darwin') {
    return macosKeychain(runner)
  }
  if (platform === 'linux' && env.DBUS_SESSION_BUS_ADDRESS) {
    return linuxSecretService(runner)
  }
  return null
}
