// Fences an agent's chat starts on this host off while its shared sign-in or installed runtime is
// replaced or removed: a chat running meanwhile could save the old account back or run deleted files.
// In memory only; a restart ends it.

import { AgentSessionPreSpawnError } from '../native-chat/agent-session-wire/structured-agent-session-adapter'

export class AcpLaunchGate {
  private operating = false
  private readonly starts = new Map<AbortController, Promise<void>>()

  constructor(private readonly refusal: string) {}

  /** A start's way in: refused while an operation runs; an operation that begins aborts it. */
  enter(signal: AbortSignal | undefined): { signal: AbortSignal; leave: () => void } {
    if (this.operating) {
      throw new AgentSessionPreSpawnError(new Error(this.refusal), {
        reason: 'accountSwitchInProgress'
      })
    }
    const controller = new AbortController()
    const left = Promise.withResolvers<void>()
    this.starts.set(controller, left.promise)
    return {
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      leave: () => {
        this.starts.delete(controller)
        left.resolve()
      }
    }
  }

  /** `work`, once the starts under way have ended and `stopLive` has stopped the running chats. */
  async run<T>(stopLive: () => Promise<void>, work: () => Promise<T>): Promise<T> {
    if (this.operating) {
      throw new Error(this.refusal)
    }
    this.operating = true
    try {
      const starts = [...this.starts]
      starts.forEach(([controller]) => controller.abort())
      await Promise.all([...starts.map(([, left]) => left), stopLive()])
      return await work()
    } finally {
      this.operating = false
    }
  }
}
