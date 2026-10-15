import { z } from 'zod'
import { StructuredAgent } from './structured-agent-session-params'

export const ManagedRuntimeAgentParams = z.strictObject({ agent: StructuredAgent })

export const ManagedRuntimeStatusParams = z.strictObject({
  agent: StructuredAgent,
  /** The revision the client shows: the host answers once it differs, or after a bounded wait. */
  shown: z.number().int().nonnegative().optional()
})

export const ManagedRuntimeCancelParams = z.strictObject({
  agent: StructuredAgent,
  operationId: z.string().min(1).max(64)
})
