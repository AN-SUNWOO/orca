// Installs a managed runtime when the person asks, on the host that runs its chats. One instance per
// runtime owns every change to its releases: it reclaims old ones once, first, then installs one at a
// time. Publishing the release by rename is the commit point; a cancel after it changes nothing.

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, rename, rm, statfs } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type {
  ManagedRuntimeInstallState,
  ManagedRuntimeOperation
} from '../../shared/managed-runtime-install'
import { getMainHttpClient, type MainHttpClient } from '../network/http-client'
import { RevisionedState } from '../runtime/revisioned-state'
import {
  reclaimRuntimeReleases,
  resolveInstalledRuntimeRelease,
  writeRuntimeReleaseReceipt,
  type ManagedRuntime,
  type ManagedRuntimePin
} from './managed-runtime-release'
import { verifyFileSha256 } from './pinned-runtime-materializer'
import {
  downloadVerifiedArchive,
  extractRuntimeArchive,
  missingArchiveExtractor,
  RUNTIME_ARCHIVE_RETRY_DELAYS_MS
} from './runtime-archive-download'

const STATUS_WAIT_MS = 25_000
const DEADLINE_MS = 45 * 60_000
const FREE_SPACE_MARGIN_BYTES = 256 * 1024 * 1024
// Each byte update answers a waiting status read.
const PROGRESS_INTERVAL_MS = 1_000

export type ManagedRuntimeInstallationDeps = {
  dataDirectory: string
  /** Whether a start would run a copy found outside Orca's releases (PATH, install folders). */
  findExternal: () => Promise<boolean>
  fetcher?: MainHttpClient['fetch']
}

type Run = { id: string; controller: AbortController; committed: boolean }

export class ManagedRuntimeInstallation {
  private readonly state = new RevisionedState<ManagedRuntimeOperation | null>(null)
  private readonly root: string
  private running: Run | null = null
  private mutation: Promise<void>

  constructor(
    private readonly agent: string,
    private readonly runtime: ManagedRuntime,
    private readonly deps: ManagedRuntimeInstallationDeps
  ) {
    this.root = runtime.root(deps.dataDirectory)
    this.mutation = this.reclaim()
  }

  /** At once without `shown`, else once the revision passes it or after a bounded wait; installed
   *  facts are reread from disk every time. */
  async status(shown?: number, signal?: AbortSignal): Promise<ManagedRuntimeInstallState> {
    await this.state.waitForChange(shown, STATUS_WAIT_MS, signal)
    const { value: operation, revision } = this.state.get()
    const pin = this.runtime.pin()
    const { release, broken, unreadable } = resolveInstalledRuntimeRelease(this.root, pin)
    // Unknown is not absent: a failed read keeps each client's last answer.
    if (unreadable && !release?.current) {
      throw new Error(`Couldn't read the installed ${this.runtime.label} files on this host.`)
    }
    const source = (await this.deps.findExternal()) ? 'external' : release ? 'managed' : null
    const missingProgram = pin && missingArchiveExtractor(pin.url)
    return {
      agent: this.agent,
      revision,
      available: pin !== null && !missingProgram,
      ...(missingProgram && { missingProgram }),
      version: pin?.version ?? null,
      installedVersion: release?.version ?? null,
      installedCurrent: release?.current ?? false,
      ...(pin && !release?.current && broken.includes(pin.version) && { damaged: true }),
      source,
      operation
    }
  }

  /** Joins the running install; one being cancelled finishes its cleanup before the next starts. */
  install(): ManagedRuntimeOperation {
    const { label } = this.runtime
    const pin = this.runtime.pin()
    if (!pin) {
      throw new Error(`${label} is not available on ${process.platform} ${process.arch}.`)
    }
    const missingProgram = missingArchiveExtractor(pin.url)
    if (missingProgram) {
      throw new Error(`Installing ${label} on this host needs ${missingProgram}.`)
    }
    const current = this.state.get().value
    const { running } = this
    if (current && current.id === running?.id && !running.controller.signal.aborted) {
      return current
    }
    const run: Run = { id: randomUUID(), controller: new AbortController(), committed: false }
    const operation: ManagedRuntimeOperation = {
      id: run.id,
      kind: 'install',
      phase: 'downloading',
      downloadedBytes: 0,
      totalBytes: pin.archiveBytes
    }
    this.running = run
    this.state.set(operation)
    this.mutation = this.mutation.then(() => this.runInstall(pin, run))
    return operation
  }

  cancel(operationId: string): void {
    if (this.state.get().value?.id !== operationId) {
      throw new Error(`That ${this.runtime.label} installation is no longer running.`)
    }
    const run = this.running
    if (run?.id === operationId && !run.committed && !run.controller.signal.aborted) {
      run.controller.abort()
      // Every client sees the cancel at once, not only when the work has unwound.
      this.publish(run, { phase: 'cancelling' })
    }
  }

  private publish(run: Run, patch: Partial<ManagedRuntimeOperation>): void {
    const operation = this.state.get().value
    // Once cancelling, only the outcome moves it: progress from the unwinding work is stale.
    const settles =
      patch.phase === 'succeeded' || patch.phase === 'cancelled' || patch.phase === 'failed'
    if (operation?.id === run.id && (operation.phase !== 'cancelling' || settles)) {
      this.state.set({ ...operation, ...patch })
    }
  }

  private async runInstall(pin: ManagedRuntimePin, run: Run): Promise<void> {
    const deadline = AbortSignal.timeout(DEADLINE_MS)
    try {
      await this.installRelease(pin, run, AbortSignal.any([run.controller.signal, deadline]))
      this.publish(run, { phase: 'succeeded' })
    } catch (error) {
      if (run.committed) {
        console.warn(`[managed-runtime] ${this.agent} installed; staging not removed:`, error)
        this.publish(run, { phase: 'succeeded' })
      } else if (run.controller.signal.aborted) {
        this.publish(run, { phase: 'cancelled' })
      } else {
        this.publish(run, {
          phase: 'failed',
          error: failureText(this.runtime.label, error, deadline)
        })
      }
    } finally {
      this.running = this.running === run ? null : this.running
    }
  }

  private async installRelease(
    pin: ManagedRuntimePin,
    run: Run,
    signal: AbortSignal
  ): Promise<void> {
    const { label } = this.runtime
    const folder = join(this.root, pin.version)
    await mkdir(this.root, { recursive: true })
    if (existsSync(folder)) {
      this.publish(run, { phase: 'verifying' })
      const whole = await verifyMembers(folder, pin, label, signal).then(
        () => true,
        (error: unknown) => {
          signal.throwIfAborted()
          console.warn(`[managed-runtime] ${this.agent} copy is damaged; repairing:`, error)
          return false
        }
      )
      if (whole) {
        run.committed = true
        return
      }
      this.publish(run, { phase: 'downloading' })
    }
    const space = await statfs(this.root)
    const needed = pin.members.reduce((sum, m) => sum + m.bytes, pin.archiveBytes)
    if (space.bavail * space.bsize < needed + FREE_SPACE_MARGIN_BYTES) {
      const megabytes = Math.ceil((needed + FREE_SPACE_MARGIN_BYTES) / 1024 ** 2)
      throw new Error(`${label} needs ${megabytes} MB of free disk space to install.`)
    }
    const staging = join(this.root, `.download-${process.pid}-${randomUUID()}`)
    const release = join(staging, 'release')
    try {
      await mkdir(release, { recursive: true })
      const archive = join(staging, basename(new URL(pin.url).pathname))
      let shownAt = 0
      await downloadVerifiedArchive(
        {
          label,
          url: pin.url,
          archiveSha256: pin.archiveSha256,
          maxArchiveBytes: pin.archiveBytes
        },
        archive,
        this.deps.fetcher ?? getMainHttpClient().fetch,
        signal,
        RUNTIME_ARCHIVE_RETRY_DELAYS_MS,
        (bytes) => {
          if (Date.now() - shownAt >= PROGRESS_INTERVAL_MS) {
            shownAt = Date.now()
            this.publish(run, { downloadedBytes: bytes })
          }
        }
      ).catch((error: unknown) => {
        if (signal.aborted || isChecksumMismatch(error)) {
          throw error
        }
        console.warn(`[managed-runtime] ${this.agent} download failed:`, error)
        throw new Error(
          `Couldn't download ${label}. Check your network connection or proxy, then try again.`,
          { cause: error }
        )
      })
      this.publish(run, { phase: 'extracting', downloadedBytes: pin.archiveBytes })
      const members = pin.members.map((member) => member.path)
      const extracted = await extractRuntimeArchive({ label, members }, archive, release, signal)
      if (extracted.code !== 0) {
        throw new Error(
          `${label} archive extraction failed: ${extracted.stderr || extracted.stdout}`
        )
      }
      this.publish(run, { phase: 'verifying' })
      await verifyMembers(release, pin, label, signal)
      await writeRuntimeReleaseReceipt(release, pin)
      signal.throwIfAborted()
      // A damaged copy moves into staging, which is deleted below or reclaimed on the next start.
      if (existsSync(folder)) {
        await rename(folder, join(staging, 'damaged'))
      }
      await rename(release, folder)
      run.committed = true
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }

  private async reclaim(): Promise<void> {
    const { release, unreadable } = resolveInstalledRuntimeRelease(this.root, this.runtime.pin())
    if (unreadable) {
      // Which release a launch runs is unknown, so nothing is provably stale.
      console.warn(`[managed-runtime] ${this.agent} releases unreadable; not reclaiming this run`)
      return
    }
    const failed = await reclaimRuntimeReleases(this.root, release?.version ?? null).catch(
      (error: unknown) => [String(error)]
    )
    if (failed.length > 0) {
      console.warn(`[managed-runtime] old ${this.agent} releases not removed:`, failed)
    }
  }
}

function failureText(label: string, error: unknown, deadline: AbortSignal): string {
  const message = error instanceof Error ? error.message : String(error)
  if (deadline.aborted) {
    return `Installing ${label} took longer than 45 minutes. Try again.`
  }
  return isChecksumMismatch(error)
    ? `The ${label} download did not match its pinned checksum, so nothing was installed.`
    : message
}

function isChecksumMismatch(error: unknown): boolean {
  return error instanceof Error && /checksum mismatch/.test(error.message)
}

async function verifyMembers(
  root: string,
  pin: ManagedRuntimePin,
  label: string,
  signal: AbortSignal
): Promise<void> {
  for (const member of pin.members) {
    const path = join(root, ...member.path.split('/'))
    await verifyFileSha256(path, member.sha256, `${label} ${member.path}`, signal)
    if (process.platform !== 'win32') {
      await chmod(path, 0o755)
    }
  }
}
