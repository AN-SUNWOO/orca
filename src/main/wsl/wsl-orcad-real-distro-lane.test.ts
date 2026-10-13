// WSL via orcad against real WSL2 distros (step C10): deploy and launch (C4), connect over the
// wsl.exe stdio bridge (C5), drive runtime RPC through it, and prove liveness (C6) on one
// systemd-off and one systemd-on distro. Two phases, each its own process, so the holder is
// proven to outlive the process that spawned it:
//   launch  - deploy, RPC, kill orcad => relaunch + census, `wsl --terminate` => terminals exited
//   survive - >= 60 s after launch exited: distros still Running, holders adopted live, reconnect,
//             teardown leaves no bridge or holder processes, WSLInterop intact
// .github/workflows/wsl-orcad-e2e.yml imports the distros and runs both phases.
//
// Run: ORCA_RUN_WSL_ORCAD_LANE=1 ORCA_WSL_ORCAD_LANE_PHASE=launch|survive pnpm test <this file>
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }))

import { runProcess } from '@orca/process-host'
import { setAppEnvironment } from '../../shared/app-environment'
import { ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES } from '../../shared/electron-remote-runtime-client-capabilities'
import { pairedRuntimeConnectionFromOffer } from '../../shared/paired-runtime-connection'
import { parsePairingCode } from '../../shared/pairing'
import { sendRemoteRuntimeRequest } from '../../shared/remote-runtime-client'
import { buildWslExecArgs } from '../../shared/wsl-login-shell-command'
import { requestOrcadTerminalCensus } from '../ssh/orcad-terminal-census-client'
import { execCommand } from '../ssh/ssh-relay-exec-command'
import { readConfirmedRunningWslDistros } from '../wsl-background-distro-gate'
import { readWindowsProcessTableFresh } from '../windows/windows-process-table'
import { resolveWslInteropSpawnCwd } from '../wsl-interop-spawn-directory'
import { createWslDistroHolder, type WslDistroHolder } from './wsl-distro-holder'
import { WSL_DISTRO_HOLDER_MARKER } from './wsl-distro-holder-command'
import { resolveWslExecutablePath } from './wsl-executable-path'
import { wslDistroHolderKey } from './wsl-distro-holder-record'
import { WslOrcadConnectionManager, type WslOrcadConnection } from './wsl-orcad-connection'
import type { WslOrcadConnectionStatus } from './wsl-orcad-connection-status'
import { defaultWslOrcadEnvironmentId } from './wsl-orcad-deploy'
import { createWslOrcadHostTransport } from './wsl-orcad-host-transport'
import type { WslOrcadLivenessSupervisor } from './wsl-orcad-liveness-supervisor'
import { createWslOrcadLivenessSupervisor } from './wsl-orcad-liveness-wiring'

const RUN = process.env.ORCA_RUN_WSL_ORCAD_LANE === '1'
const PHASE = process.env.ORCA_WSL_ORCAD_LANE_PHASE ?? 'launch'
const PLAIN = process.env.ORCA_WSL_ORCAD_LANE_PLAIN_DISTRO ?? 'orca-lane-plain'
const SYSTEMD = process.env.ORCA_WSL_ORCAD_LANE_SYSTEMD_DISTRO ?? 'orca-lane-systemd'
const DISTROS = [
  { name: PLAIN, systemd: false },
  { name: SYSTEMD, systemd: true }
]
const WORK_DIR = process.env.ORCA_WSL_ORCAD_LANE_DIR ?? join(tmpdir(), 'orca-wsl-orcad-lane')
const USER_DATA = join(WORK_DIR, 'userData')
const STATE_FILE = join(WORK_DIR, 'launch-state.json')
const RECEIPT_DIR = process.env.ORCA_WSL_ORCAD_LANE_RECEIPTS ?? join(WORK_DIR, 'receipts')
const HOLDER_SURVIVAL_MS = 60_000
const DISTRO_TIMEOUT_MS = 12 * 60_000
const BRIDGE_PATTERN = '[o]rcadStdioBridge'
const WSL_INTEROP = '/proc/sys/fs/binfmt_misc/WSLInterop'

type LaunchState = {
  launchEndedAtMs: number
  orcadPids: Record<string, number | null>
}
type Receipt = Record<string, unknown>

const receipt: Receipt = { phase: PHASE }
const interopChecks: Receipt[] = []
receipt.wslInterop = interopChecks
const statuses = new Map<string, WslOrcadConnectionStatus[]>()
let visibleWork = true
let holder: WslDistroHolder
let manager: WslOrcadConnectionManager
let supervisor: WslOrcadLivenessSupervisor | null = null

function installLaneAppEnvironment(): void {
  const { version } = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
  setAppEnvironment({
    getPath: (name) => (name === 'userData' ? USER_DATA : tmpdir()),
    getAppPath: () => process.cwd(),
    getVersion: () => version,
    isPackaged: () => false,
    onWillQuit: () => {},
    exit: () => {},
    getAppMetrics: () => []
  })
}

function statusLog(distro: string): WslOrcadConnectionStatus[] {
  const key = wslDistroHolderKey(distro)
  const log = statuses.get(key) ?? []
  statuses.set(key, log)
  return log
}

function transportFor(distro: string) {
  return createWslOrcadHostTransport({
    target: {
      kind: 'wsl',
      id: defaultWslOrcadEnvironmentId(distro),
      distro,
      label: distro
    }
  })
}

/** As the distro's default user, through the same transport orcad's deploy uses. */
function guest(distro: string, command: string): Promise<string> {
  return execCommand(transportFor(distro), command, { timeoutMs: 60_000 })
}

async function wslExe(args: string[], timeoutMs = 60_000) {
  const result = await runProcess({
    program: resolveWslExecutablePath(),
    args,
    cwd: resolveWslInteropSpawnCwd(),
    env: { ...process.env, WSL_UTF8: '1' },
    timeoutMs
  })
  return {
    code: result.code,
    output: `${result.stdout}${result.stderr}`.trim()
  }
}

function asRoot(distro: string, script: string) {
  return wslExe(buildWslExecArgs(distro, ['sh', '-c', script], { user: 'root' }))
}

/** WSL < 3.0.1 lost this VM-wide entry when a systemd distro stopped (microsoft/WSL#13885). */
async function assertWslInteropIntact(viaDistro: string, label: string): Promise<void> {
  const probe = await asRoot(
    viaDistro,
    `if [ -e ${WSL_INTEROP} ]; then echo present; else ` +
      `echo ':WSLInterop:M::MZ::/init:P' > /proc/sys/fs/binfmt_misc/register && echo restored; fi`
  )
  interopChecks.push({ label, viaDistro, result: probe.output })
  // Restored above so later jobs on this runner are not poisoned; the lane still fails.
  expect(probe.output, `WSLInterop ${label}`).toBe('present')
  const ver = await guest(viaDistro, '/mnt/c/Windows/System32/cmd.exe /c ver')
  expect(ver).toMatch(/Windows/u)
}

async function waitFor<T>(
  what: string,
  read: () => T | null | undefined | Promise<T | null | undefined>,
  timeoutMs: number,
  intervalMs = 100
): Promise<T> {
  const deadline = performance.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (value !== null && value !== undefined) {
      return value
    }
    if (performance.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`)
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

function waitForStatus<S extends WslOrcadConnectionStatus['state']>(
  distro: string,
  since: number,
  state: S,
  timeoutMs: number
): Promise<Extract<WslOrcadConnectionStatus, { state: S }>> {
  return waitFor(
    `${distro} to report ${state} (saw ${JSON.stringify(statusLog(distro).slice(since))})`,
    () =>
      statusLog(distro)
        .slice(since)
        .find((status): status is Extract<WslOrcadConnectionStatus, { state: S }> => {
          return status.state === state
        }),
    timeoutMs
  )
}

function pairedConnection(connection: WslOrcadConnection) {
  const offer = parsePairingCode(connection.pairingOffer)
  if (!offer) {
    throw new Error(`Unparseable pairing offer for ${connection.distro}`)
  }
  return pairedRuntimeConnectionFromOffer(offer)
}

async function rpc<T>(connection: WslOrcadConnection, method: string, params?: unknown) {
  const response = await sendRemoteRuntimeRequest<T>(
    pairedConnection(connection),
    method,
    params,
    30_000,
    undefined,
    undefined,
    ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES
  )
  if (!response.ok) {
    throw new Error(`${method} failed: ${response.error.code}: ${response.error.message}`)
  }
  return response.result
}

async function runningDistros(): Promise<string[]> {
  const running = await readConfirmedRunningWslDistros()
  if (running.status !== 'confirmed') {
    throw new Error('wsl --list --running was unavailable')
  }
  return running.distros.map(wslDistroHolderKey)
}

/** Windows-side wsl.exe children still carrying a bridge or a holder for this lane's distros. */
async function laneWindowsProcesses(): Promise<string[]> {
  const names = DISTROS.map((d) => d.name.toLowerCase())
  return (await readWindowsProcessTableFresh())
    .filter((row) => /^wsl(host)?\.exe$/iu.test(row.name))
    .map((row) => row.command)
    .filter((command) => names.some((name) => command.toLowerCase().includes(name)))
    .filter(
      (command) =>
        command.includes('orcadStdioBridge') || command.includes(WSL_DISTRO_HOLDER_MARKER)
    )
}

/** A closed bridge's guest half ends on stdin EOF, a moment after the Windows side. */
async function expectNoGuestBridges(distro: string): Promise<void> {
  const count = async () =>
    Number.parseInt(await guest(distro, `pgrep -fc '${BRIDGE_PATTERN}' || true`), 10) || 0
  const left = await waitFor(
    `bridges in ${distro} to exit`,
    async () => ((await count()) === 0 ? 0 : null),
    15_000,
    500
  ).catch(count)
  expect(left, `bridges left in ${distro}`).toBe(0)
}

function createLaneManager(): void {
  holder = createWslDistroHolder({
    userDataPath: USER_DATA,
    onHolderExit: (distro, exit) => supervisor?.noteHolderExit(distro, exit)
  })
  manager = new WslOrcadConnectionManager({
    holder,
    onChange: (distro, _connection, status) => {
      statusLog(distro).push(status)
      console.log(`[lane] ${distro} ${JSON.stringify(status)}`)
    }
  })
}

/** status, repo add on a fresh `git init`, terminal create, and its output read back. */
async function proveRuntimeRpc(connection: WslOrcadConnection, distro: string): Promise<Receipt> {
  const status = await rpc<{ runtimeId?: string }>(connection, 'status.get')
  expect(status.runtimeId).toEqual(expect.any(String))
  const repoPath = (
    await guest(
      distro,
      'set -e; d="$HOME/wsl-orcad-lane-repo"; rm -rf "$d"; mkdir -p "$d"; cd "$d"; ' +
        'git init -q -b main; git -c user.email=lane@orca.test -c user.name=lane ' +
        'commit -q --allow-empty -m seed; printf %s "$d"'
    )
  ).trim()
  const added = await rpc<{ repo: { id: string } }>(connection, 'repo.add', {
    path: repoPath
  })
  expect(added.repo.id).toEqual(expect.any(String))
  const created = await rpc<{ terminal: { handle: string } }>(connection, 'terminal.create', {
    worktree: `path:${repoPath}`
  })
  const handle = created.terminal.handle
  expect(handle).toEqual(expect.any(String))
  const nonce = randomBytes(6).toString('hex')
  // printf splits the token so the echoed input line never matches it.
  await rpc(connection, 'terminal.send', {
    terminal: handle,
    text: `printf 'WSL_LANE_%s\\n' ${nonce}`,
    enter: true
  })
  await waitFor(
    `terminal output token in ${distro}`,
    async () => {
      const read = await rpc<{ terminal: { tail?: unknown[] } }>(connection, 'terminal.read', {
        terminal: handle
      })
      return (read.terminal.tail ?? []).map(String).join('\n').includes(`WSL_LANE_${nonce}`)
        ? true
        : null
    },
    60_000,
    500
  )
  return {
    runtimeId: status.runtimeId,
    repoId: added.repo.id,
    terminal: handle
  }
}

async function launchPhase(distro: string, systemd: boolean): Promise<Receipt> {
  const result: Receipt = {}
  visibleWork = true
  if (!supervisor) {
    throw new Error('supervisor missing')
  }
  let started = performance.now()
  const connection = await supervisor.connect(distro)
  result.connectMs = Math.round(performance.now() - started)
  result.orcadVersion = connection.fullVersion
  expect(connection.pid).toEqual(expect.any(Number))
  const pid1 = (await guest(distro, 'ps -p 1 -o comm=')).trim()
  result.pid1 = pid1
  if (systemd) {
    expect(pid1).toBe('systemd')
  } else {
    expect(pid1).not.toBe('systemd')
  }
  expect(await runningDistros()).toContain(wslDistroHolderKey(distro))
  result.rpc = await proveRuntimeRpc(connection, distro)

  // orcad killed: the watch sees it, the verdict is orcad-exited, and recovery relaunches it.
  let since = statusLog(distro).length
  started = performance.now()
  await guest(distro, `kill -9 ${connection.pid}; true`)
  const recovering = await waitForStatus(distro, since, 'reconnecting', 30_000)
  expect(recovering.reason).toBe('orcad-exited')
  result.killDetectMs = Math.round(performance.now() - started)
  const ready = await waitForStatus(distro, since, 'ready', 180_000)
  result.killRecoverMs = Math.round(performance.now() - started)
  expect(ready.census).not.toBeNull()
  result.census = ready.census
  const relaunched = manager.get(distro)
  if (!relaunched) {
    throw new Error(`${distro} reported ready without a connection`)
  }
  expect(relaunched.pid).toEqual(expect.any(Number))
  expect(relaunched.pid).not.toBe(connection.pid)
  await rpc(relaunched, 'status.get')

  // `wsl --terminate`: nothing user-visible, so the verdict stands and nothing reboots it.
  visibleWork = false
  since = statusLog(distro).length
  started = performance.now()
  const terminated = await wslExe(['--terminate', distro])
  expect(terminated.code, terminated.output).toBe(0)
  const stopped = await waitForStatus(distro, since, 'distro-stopped', 30_000)
  result.terminateDetectMs = Math.round(performance.now() - started)
  expect(stopped).toMatchObject({ terminals: 'exited', recovering: false })
  expect(await runningDistros()).not.toContain(wslDistroHolderKey(distro))
  if (systemd) {
    await assertWslInteropIntact(PLAIN, `after terminating ${distro}`)
  }

  // A user connect is the one path allowed to boot it again.
  visibleWork = true
  started = performance.now()
  const rebooted = await supervisor.connect(distro)
  result.rebootConnectMs = Math.round(performance.now() - started)
  await rpc(rebooted, 'status.get')
  if (systemd) {
    await assertWslInteropIntact(distro, `after rebooting ${distro}`)
  }
  result.orcadPid = rebooted.pid
  return result
}

async function survivePhase(): Promise<void> {
  const state: LaunchState = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  const waitMs = state.launchEndedAtMs + HOLDER_SURVIVAL_MS - Date.now()
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
  const secondsSinceLaunchExited = Math.round((Date.now() - state.launchEndedAtMs) / 1000)
  receipt.secondsSinceLaunchExited = secondsSinceLaunchExited
  // Only the holders keep them up: no other wsl.exe client survived the launch process.
  const running = await runningDistros()
  for (const { name } of DISTROS) {
    expect(running, `${name} Running ${secondsSinceLaunchExited} s later`).toContain(
      wslDistroHolderKey(name)
    )
  }
  const adopted = await holder.adoptHolders()
  receipt.adopted = adopted
  for (const { name } of DISTROS) {
    expect(adopted).toContainEqual({ distro: name, state: 'live' })
  }
  for (const { name } of DISTROS) {
    const connection = await manager.ensure(name)
    await rpc(connection, 'status.get')
    receipt[`${name}.census`] = await requestOrcadTerminalCensus(pairedConnection(connection), 0)
  }

  // Teardown: bridges closed, holders released, distros terminated.
  await manager.dispose()
  for (const { name } of DISTROS) {
    await expectNoGuestBridges(name)
  }
  const released: Receipt = {}
  receipt.released = released
  for (const { name } of DISTROS) {
    // A holder caught mid-exit can read `unverifiable` (no command line yet no exit); it must settle.
    released[name] = await holder.release(name)
    await waitFor(
      `the ${name} holder to exit`,
      async () => ((await holder.holderState(name)) === 'exited' ? true : null),
      10_000,
      250
    )
  }
  // The systemd distro stops while the plain one still runs, so the interop entry is shared.
  expect((await wslExe(['--terminate', SYSTEMD])).code).toBe(0)
  await assertWslInteropIntact(PLAIN, `after final terminate of ${SYSTEMD}`)
  expect((await wslExe(['--terminate', PLAIN])).code).toBe(0)
  const leftovers = await waitFor(
    'lane wsl.exe processes to exit',
    async () => {
      const rows = await laneWindowsProcesses()
      return rows.length === 0 ? rows : null
    },
    15_000,
    500
  ).catch(async () => laneWindowsProcesses())
  expect(leftovers, 'wsl.exe bridge/holder processes after teardown').toEqual([])
}

describe.runIf(RUN && process.platform === 'win32')('WSL orcad on real WSL2 distros', () => {
  beforeAll(async () => {
    mkdirSync(USER_DATA, { recursive: true })
    mkdirSync(RECEIPT_DIR, { recursive: true })
    installLaneAppEnvironment()
    createLaneManager()
    receipt.wslVersion = (await wslExe(['--version'])).output
  })

  afterAll(async () => {
    await supervisor?.dispose().catch(() => {})
    await manager?.dispose().catch(() => {})
    writeFileSync(join(RECEIPT_DIR, `${PHASE}.json`), `${JSON.stringify(receipt, null, 2)}\n`)
  })

  it.runIf(PHASE === 'launch')(
    'deploys, serves RPC, recovers a killed orcad and reports a terminated distro',
    async () => {
      supervisor = createWslOrcadLivenessSupervisor({
        manager,
        holder,
        hasUserVisibleWork: () => visibleWork
      })
      const pids: LaunchState['orcadPids'] = {}
      for (const { name, systemd } of DISTROS) {
        const result = await launchPhase(name, systemd)
        receipt[name] = result
        pids[name] = typeof result.orcadPid === 'number' ? result.orcadPid : null
      }
      // Bridges and watches go; the holders must not.
      await supervisor.dispose()
      supervisor = null
      await manager.dispose()
      for (const { name } of DISTROS) {
        await expectNoGuestBridges(name)
      }
      const state: LaunchState = {
        launchEndedAtMs: Date.now(),
        orcadPids: pids
      }
      writeFileSync(STATE_FILE, JSON.stringify(state))
    },
    DISTROS.length * DISTRO_TIMEOUT_MS
  )

  it.runIf(PHASE === 'survive')(
    'keeps both distros held after the launching process exited, then tears down cleanly',
    survivePhase,
    DISTRO_TIMEOUT_MS
  )
})
