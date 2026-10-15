const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const fs = require('node:fs/promises')
const pty = require(process.argv[3])
const canary = require(process.argv[2])

const target = 30_000_000
const began = Date.now()
const terminal = pty.spawn(
  '/bin/sh',
  ['-c', 'while IFS= read -r line; do printf "ECHO:%s\\n" "$line"; done'],
  { cwd: process.argv[4], env: process.env }
)
let output = ''
terminal.onData((chunk) => {
  output = (output + chunk).slice(-4096)
})
const deadline = setTimeout(() => {
  console.error('Stress run exceeded five minutes')
  terminal.kill()
  process.kill(process.pid, 'SIGKILL')
}, 300_000)

async function echo(marker) {
  terminal.write(`${marker}\r`)
  for (let i = 0; i < 1000; i++) {
    if (output.includes(`ECHO:${marker}`)) {
      return
    }
    await delay(10)
  }
  throw new Error(`No PTY echo for ${marker}`)
}

async function main() {
  await echo('ORCA_BEFORE')
  canary.startStress()
  let previous = 0
  let lastProgress = Date.now()
  let lastPrint = 0
  while (canary.stressProgress() < target) {
    await delay(100)
    const completed = canary.stressProgress()
    if (completed !== previous) {
      previous = completed
      lastProgress = Date.now()
    }
    if (Date.now() - lastPrint > 10_000) {
      console.log(JSON.stringify({ elapsedMs: Date.now() - began, completed }))
      lastPrint = Date.now()
    }
    if (Date.now() - lastProgress > 3000) {
      let statCallbacks = 0
      let echoed = false
      for (let i = 0; i < 4; i++) {
        void fs.stat(process.execPath).then(() => statCallbacks++)
      }
      void echo('ORCA_AFTER_STALL')
        .then(() => (echoed = true))
        .catch(() => {})
      await delay(15_000)
      assert.ok(
        canary.stressProgress() > completed || statCallbacks > 0 || echoed,
        `Workers stranded after ${completed} jobs: no progress, stat callbacks or PTY echo`
      )
      lastProgress = Date.now()
    }
  }
  await fs.stat(process.execPath)
  await echo('ORCA_AFTER')
  console.log(JSON.stringify({ result: 'passed', arch: process.arch, completed: target }))
  clearTimeout(deadline)
  terminal.kill()
}
main().catch((error) => {
  console.error(error)
  terminal.kill()
  // Stalled libuv cleanup can block process.exit().
  process.kill(process.pid, 'SIGKILL')
})
