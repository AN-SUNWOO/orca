import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  SERVE_INIT_REAPER_SCRIPT,
  reexecServeUnderInitReaper,
  type ServeInitReaperDeps
} from './serve-pid1-init-reaper'

function deps(overrides: Partial<ServeInitReaperDeps> = {}): ServeInitReaperDeps {
  return {
    platform: 'linux',
    pid: 1,
    env: { ELECTRON_RUN_AS_NODE: '1' },
    execPath: '/opt/orca/orca-ide',
    execArgv: [],
    argv: ['/opt/orca/orca-ide', '/opt/orca/resources/cli/index.js', 'serve', '--port', '6768'],
    exists: (path) => path === '/bin/bash',
    execve: vi.fn(),
    warn: vi.fn(),
    ...overrides
  }
}

describe('reexecServeUnderInitReaper', () => {
  it('replaces a PID 1 Linux serve with bash running the same command and environment', () => {
    const d = deps()
    expect(reexecServeUnderInitReaper(d)).toBe('reexec')
    expect(d.execve).toHaveBeenCalledWith(
      '/bin/bash',
      [
        'bash',
        '-c',
        SERVE_INIT_REAPER_SCRIPT,
        'orca-serve-init',
        '/opt/orca/orca-ide',
        '/opt/orca/resources/cli/index.js',
        'serve',
        '--port',
        '6768'
      ],
      { ELECTRON_RUN_AS_NODE: '1' }
    )
  })

  it('keeps the eval script of a `-e <cli> -- serve` launch', () => {
    const d = deps({ execArgv: ['-e', 'require(cli)'], argv: ['/opt/orca/orca-ide', 'serve'] })
    expect(reexecServeUnderInitReaper(d)).toBe('reexec')
    expect(vi.mocked(d.execve!).mock.calls[0][1].slice(4)).toEqual([
      '/opt/orca/orca-ide',
      '-e',
      'require(cli)',
      '--',
      'serve'
    ])
  })

  it('runs a mounted AppImage afresh instead of the files its exec would unmount', () => {
    const d = deps({
      execPath: '/tmp/.mount_orcaX/orca-ide',
      argv: ['/tmp/.mount_orcaX/orca-ide', '/tmp/.mount_orcaX/resources/cli/index.js', 'serve'],
      env: {
        APPDIR: '/tmp/.mount_orcaX',
        APPIMAGE: '/opt/orca/orca.AppImage',
        ELECTRON_RUN_AS_NODE: '1',
        ORCA_NODE_OPTIONS: '--max-old-space-size=4096',
        ORCA_NODE_REPL_EXTERNAL_MODULE: ''
      },
      exists: (path) => path === '/bin/bash' || path === '/opt/orca/orca.AppImage'
    })
    expect(reexecServeUnderInitReaper(d)).toBe('reexec')
    const [, args, env] = vi.mocked(d.execve!).mock.calls[0]
    expect(args.slice(4)).toEqual(['/opt/orca/orca.AppImage', 'serve'])
    expect(env).toEqual({
      APPDIR: '/tmp/.mount_orcaX',
      APPIMAGE: '/opt/orca/orca.AppImage',
      NODE_OPTIONS: '--max-old-space-size=4096'
    })
  })

  it('warns instead of re-execing a mounted AppImage whose image cannot be found', () => {
    const d = deps({
      execPath: '/tmp/.mount_orcaX/orca-ide',
      env: { APPDIR: '/tmp/.mount_orcaX' }
    })
    expect(reexecServeUnderInitReaper(d)).toBe('unavailable')
    expect(d.execve).not.toHaveBeenCalled()
  })

  it('leaves a serve that is not PID 1, or not on Linux, alone', () => {
    for (const d of [deps({ pid: 4242 }), deps({ platform: 'darwin' })]) {
      expect(reexecServeUnderInitReaper(d)).toBe('not-pid1')
      expect(d.execve).not.toHaveBeenCalled()
      expect(d.warn).not.toHaveBeenCalled()
    }
  })

  it('warns and keeps serving when no bash is installed or the process cannot be replaced', () => {
    for (const d of [
      deps({ exists: () => false }),
      deps({ execve: null }),
      deps({
        execve: () => {
          throw new Error('ENOENT')
        }
      })
    ]) {
      expect(reexecServeUnderInitReaper(d)).toBe('unavailable')
      expect(d.warn).toHaveBeenCalledWith(expect.stringContaining('docker run --init'))
    }
  })
})

const bash = ['/bin/bash', '/usr/bin/bash'].find((path) => existsSync(path))

// Linux only: the script only runs there, and macOS's bash 3.2 cannot un-ignore INT in an async subshell.
describe.skipIf(!bash || process.platform !== 'linux')('serve init reaper script', () => {
  const run = (child: string, input = '') =>
    spawnSync(bash!, ['-c', SERVE_INIT_REAPER_SCRIPT, 'init', bash!, '-c', child], {
      input,
      encoding: 'utf8'
    })

  it("exits with the served command's status and passes its stdin through", () => {
    const result = run('read line; echo "got $line"; exit 7', 'hello\n')
    expect(result.stdout).toBe('got hello\n')
    expect(result.status).toBe(7)
  })

  it('exits with the status the served command chose after a forwarded signal', async () => {
    // Why repeated: the trap interrupting `wait` races the child's exit.
    for (let attempt = 0; attempt < 20; attempt++) {
      const child = spawn(
        bash!,
        [
          '-c',
          SERVE_INIT_REAPER_SCRIPT,
          'init',
          bash!,
          '-c',
          "trap 'exit 0' TERM; echo ready; while :; do sleep 0.01; done"
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] }
      )
      await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()))
      child.kill('SIGTERM')
      const code = await new Promise<number | null>((resolve) => child.once('exit', resolve))
      expect(code).toBe(0)
    }
  })

  it.each(['SIGINT', 'SIGTERM'] as const)('forwards %s to the served command', async (signal) => {
    const child = spawn(
      bash!,
      [
        '-c',
        SERVE_INIT_REAPER_SCRIPT,
        'init',
        bash!,
        '-c',
        `trap 'echo caught; exit 5' ${signal.slice(3)}; echo ready; while :; do sleep 0.05; done`
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] }
    )
    let stdout = ''
    child.stdout.setEncoding('utf8')
    await new Promise<void>((resolve) => {
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
        if (stdout.includes('ready')) {
          resolve()
        }
      })
    })
    child.kill(signal)
    const code = await new Promise<number | null>((resolve) => child.once('exit', resolve))
    expect(stdout).toContain('caught')
    expect(code).toBe(5)
  })

  const canUnsharePid =
    process.platform === 'linux' &&
    spawnSync('unshare', ['--user', '--map-root-user', '--pid', '--fork', '--mount-proc', 'true'])
      .status === 0

  it.skipIf(!canUnsharePid)('reaps orphans reparented to it as PID 1', () => {
    // Each `(sleep &)` orphans a sleep onto PID 1 that exits while the served command still runs.
    const child = [
      'for i in 1 2 3 4 5; do (sleep 0.05 &); done',
      'sleep 1',
      'grep -l "^State:.*Z" /proc/[0-9]*/status 2>/dev/null | wc -l'
    ].join('; ')
    const result = spawnSync(
      'unshare',
      [
        '--user',
        '--map-root-user',
        '--pid',
        '--fork',
        '--mount-proc',
        bash!,
        '-c',
        SERVE_INIT_REAPER_SCRIPT,
        'init',
        bash!,
        '-c',
        child
      ],
      { encoding: 'utf8' }
    )
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('0')
  })
})
