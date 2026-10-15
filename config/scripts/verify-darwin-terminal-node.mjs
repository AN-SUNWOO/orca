import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { ensureDarwinTerminalNode } from './build-darwin-terminal-node.mjs'
import { preparePinnedNodeDir } from './pinned-node-downloads.mjs'
import { NODE_RUNTIME_PIN } from '../../src/shared/node-runtime-pin.ts'

if (process.platform !== 'darwin') {
  throw new Error('Verify the Darwin terminal runtime on a macOS host')
}
const executable = await ensureDarwinTerminalNode({ arch: process.arch })
const scratch = mkdtempSync(join(tmpdir(), 'orca-darwin-terminal-node-proof-'))
const require = createRequire(import.meta.url)
try {
  const headers = await preparePinnedNodeDir({
    target: `darwin-${process.arch}`,
    workDir: join(scratch, 'headers')
  })
  const addon = join(scratch, 'worker-wait.node')
  const compiled = await runProcess({
    program: 'clang',
    args: [
      '-O2',
      '-shared',
      '-fPIC',
      '-undefined',
      'dynamic_lookup',
      '-I',
      join(headers, 'include/node'),
      join(import.meta.dirname, '__fixtures__/darwin-terminal-worker-wait.c'),
      '-o',
      addon
    ],
    timeoutMs: 60_000
  })
  if (compiled.code !== 0) {
    throw new Error(compiled.stderr)
  }
  const result = await runProcess({
    program: executable,
    args: [
      join(import.meta.dirname, 'darwin-terminal-node-probe.cjs'),
      addon,
      require.resolve('node-pty'),
      scratch,
      `v${NODE_RUNTIME_PIN.version}`
    ],
    env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1', UV_THREADPOOL_SIZE: '4' },
    timeoutMs: 60_000
  })
  if (result.code !== 0) {
    throw new Error(`Runtime proof failed (${result.code}): ${result.stderr}`)
  }
  console.log(result.stdout.trim())
  if (process.env.ORCA_DARWIN_WORKER_STRESS === '1') {
    const stress = await runProcess({
      program: executable,
      args: [
        join(import.meta.dirname, 'darwin-terminal-worker-stress.cjs'),
        addon,
        require.resolve('node-pty'),
        scratch
      ],
      env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1', UV_THREADPOOL_SIZE: '4' },
      timeoutMs: 310_000
    })
    console.log(stress.stdout.trim())
    if (stress.code !== 0) {
      throw new Error(`Sequential worker stress failed: ${stress.stderr}`)
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
