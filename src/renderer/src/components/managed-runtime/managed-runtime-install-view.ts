import { translate } from '@/i18n/i18n'
import type { ManagedRuntimeInstallState } from '../../../../shared/managed-runtime-install'
import type { ManagedRuntimeInstallSnapshot } from '@/runtime/managed-runtime-install-status'

export type ManagedRuntimeInstallSurface = 'settings' | 'chat'

export type ManagedRuntimeInstallAction =
  | { kind: 'install'; label: string }
  | { kind: 'cancel'; label: string; operationId: string; disabled?: true }

export type ManagedRuntimeInstallView = {
  status: string | null
  /** Percent downloaded, while a download of known size runs. */
  progress: number | null
  /** Why the last operation or status read failed. */
  error: string | null
  action: ManagedRuntimeInstallAction | null
  /** Settings may offer to delete the copy Orca installed: one is there and nothing runs. */
  removable: boolean
}

const megabytes = (bytes: number): string => (bytes / 1_000_000).toFixed(1)

function runningView(
  operation: NonNullable<ManagedRuntimeInstallState['operation']>,
  agent: string
): ManagedRuntimeInstallView | null {
  const { phase, downloadedBytes: done, totalBytes: total } = operation
  if (phase === 'removing') {
    const status = translate('components.managed-runtime.removing', 'Removing…')
    return { status, progress: null, error: null, action: null, removable: false }
  }
  const status =
    phase === 'downloading'
      ? total === null
        ? translate('components.managed-runtime.downloading', 'Downloading {{done}} MB.', {
            done: megabytes(done)
          })
        : translate(
            'components.managed-runtime.downloadingOf',
            'Downloading {{done}} MB of {{total}} MB.',
            { done: megabytes(done), total: megabytes(total) }
          )
      : phase === 'extracting'
        ? translate('components.managed-runtime.extracting', 'Extracting {{agent}}.', { agent })
        : phase === 'verifying'
          ? translate('components.managed-runtime.verifying', 'Checking the download.')
          : phase === 'cancelling'
            ? translate('components.managed-runtime.cancelling', 'Cancelling…')
            : null
  if (status === null) {
    return null
  }
  const label = translate('components.managed-runtime.cancel', 'Cancel installation')
  return {
    status,
    progress: phase === 'downloading' && total ? Math.min(100, (done / total) * 100) : null,
    error: null,
    action: {
      kind: 'cancel',
      label,
      operationId: operation.id,
      ...(phase === 'cancelling' && { disabled: true })
    },
    removable: false
  }
}

function settledView(
  state: ManagedRuntimeInstallState,
  agent: string,
  surface: ManagedRuntimeInstallSurface
): ManagedRuntimeInstallView {
  const { operation } = state
  const failed = operation?.phase === 'failed'
  const error = failed
    ? (operation.error ??
      translate('components.managed-runtime.failed', 'Installation failed. Try again.'))
    : null
  const view = (status: string | null, label: string | null): ManagedRuntimeInstallView => ({
    status,
    progress: null,
    error,
    action: label === null ? null : { kind: 'install', label },
    removable: surface === 'settings' && state.installedVersion !== null
  })
  const install = translate('components.managed-runtime.install', 'Install {{agent}}', { agent })
  // A start already runs a working copy found outside Orca's releases; it needs no download.
  if (state.source === 'external') {
    return view(
      translate(
        'components.managed-runtime.external',
        'Uses the copy of {{agent}} found on this host.',
        { agent }
      ),
      null
    )
  }
  if (state.installedVersion !== null) {
    // Reinstall and Update belong to Settings; an installed chat shows its composer instead.
    const settings = surface === 'settings'
    return state.installedCurrent
      ? view(
          translate('components.managed-runtime.installed', 'Installed.'),
          settings
            ? translate('components.managed-runtime.reinstall', 'Reinstall {{agent}}', { agent })
            : null
        )
      : view(
          translate(
            'components.managed-runtime.updateAvailable',
            'Version {{installed}} installed. {{version}} is available.',
            { installed: state.installedVersion, version: state.version ?? '' }
          ),
          settings
            ? translate('components.managed-runtime.update', 'Update {{agent}}', { agent })
            : null
        )
  }
  if (!state.available) {
    return view(
      state.missingProgram
        ? translate(
            'components.managed-runtime.missingProgram',
            'Installing {{agent}} on this host needs {{program}}.',
            { agent, program: state.missingProgram }
          )
        : translate(
            'components.managed-runtime.unavailable',
            '{{agent}} is not available on this host.',
            { agent }
          ),
      null
    )
  }
  // Install repairs it, so it is offered as Install rather than as a retry.
  if (state.damaged) {
    return view(
      translate('components.managed-runtime.damaged', 'This copy of {{agent}} is damaged.', {
        agent
      }),
      install
    )
  }
  const retry = translate('components.managed-runtime.retry', 'Retry installation')
  if (operation?.kind === 'install' && operation.phase === 'cancelled') {
    return view(translate('components.managed-runtime.cancelled', 'Installation cancelled.'), retry)
  }
  if (operation?.kind === 'install' && failed) {
    return view(null, retry)
  }
  // The chat card's heading already says it is not installed; the size says what Install costs.
  const size = state.downloadBytes
  const idle =
    size !== undefined
      ? translate('components.managed-runtime.downloadSize', '{{size}} MB download.', {
          size: megabytes(size)
        })
      : surface === 'chat'
        ? null
        : translate('components.managed-runtime.notInstalled', 'Not installed.')
  return view(idle, install)
}

/** What an install row says and offers for the host's answer. */
export function managedRuntimeInstallView(
  snapshot: ManagedRuntimeInstallSnapshot,
  agent: string,
  surface: ManagedRuntimeInstallSurface
): ManagedRuntimeInstallView {
  if (snapshot.kind !== 'known') {
    return {
      status: null,
      progress: null,
      error:
        snapshot.kind === 'readFailed'
          ? translate(
              'components.managed-runtime.readFailed',
              'Could not check {{agent}} on this host.',
              { agent }
            )
          : null,
      action: null,
      removable: false
    }
  }
  const { operation } = snapshot.state
  return (
    (operation ? runningView(operation, agent) : null) ??
    settledView(snapshot.state, agent, surface)
  )
}
