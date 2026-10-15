import { useLayoutEffect, useMemo, useRef } from 'react'
import {
  isSubagentGroupBlock,
  type NativeChatBlock,
  type NativeChatMessage
} from '../../../src/shared/native-chat-types'

/** Where each drawn row sits on the page. A folded row's id is its first message's, so older
 *  messages joining a run would replace the row; its key stays while any of its messages draw. */
export type MobileNativeChatRowKeys = {
  /** The source window's first message: it changes when a page, a cap trim or a replacement lands,
   *  even while every row keeps its key. */
  sourceHead: string | undefined
  keyOf: (message: NativeChatMessage) => string
  /** The key now drawing what a key of the last render drew; undefined once all of it left. */
  current: (key: string) => string | undefined
}

type Assigned = {
  rows: readonly NativeChatMessage[]
  messages: readonly NativeChatMessage[]
  keyById: ReadonlyMap<string, string>
}

/** The fold keeps its sources' block objects, so a block names the message it came from. */
function blockOwners(messages: readonly NativeChatMessage[]): Map<NativeChatBlock, string> {
  const owners = new Map<NativeChatBlock, string>()
  for (const message of messages) {
    for (const block of message.blocks) {
      if (!owners.has(block)) {
        owners.set(block, message.id)
      }
    }
  }
  return owners
}

/** The messages a row draws, newest first, then the row itself. A roster's group block is made by
 *  the fold, so its group stands for it. */
function membersOf(row: NativeChatMessage, owners: Map<NativeChatBlock, string>): string[] {
  const members: string[] = []
  for (let at = row.blocks.length - 1; at >= 0; at -= 1) {
    const block = row.blocks[at]!
    const member = isSubagentGroupBlock(block)
      ? `subagent-group:${block.groupId}`
      : owners.get(block)
    if (member !== undefined) {
      members.push(member)
    }
  }
  members.push(row.id)
  return members
}

export function assignMobileNativeChatRowKeys(
  previous: Assigned | null,
  rows: readonly NativeChatMessage[],
  messages: readonly NativeChatMessage[]
): { keyById: Map<string, string>; moved: Map<string, string | undefined> } {
  const keyById = new Map<string, string>()
  const taken = new Set<string>()
  const take = (row: NativeChatMessage, key: string): void => {
    keyById.set(row.id, key)
    taken.add(key)
  }
  // A surviving row keeps its key before any vanished one is handed on.
  for (const row of rows) {
    const key = previous?.keyById.get(row.id)
    if (key !== undefined) {
      take(row, key)
    }
  }
  const ids = new Set(rows.map((row) => row.id))
  const vanished = previous?.rows.filter((row) => !ids.has(row.id)) ?? []
  const keyByMember = new Map<string, string>()
  let members: string[][] = []
  if (previous && vanished.length > 0) {
    const keyOfVanished = (row: NativeChatMessage): string => previous.keyById.get(row.id) ?? row.id
    // Own ids first: a sidecar keeps its own row while giving its results to the run.
    vanished.forEach((row) => keyByMember.set(row.id, keyOfVanished(row)))
    const previousOwners = blockOwners(previous.messages)
    for (const row of vanished) {
      for (const member of membersOf(row, previousOwners)) {
        if (!keyByMember.has(member)) {
          keyByMember.set(member, keyOfVanished(row))
        }
      }
    }
    const owners = blockOwners(messages)
    members = rows.map((row) => membersOf(row, owners))
    // Newest first, rows and members: when a cap trim splits a run, the run (not the orphan
    // result above it) keeps the key, and an orphan merging into the run after it takes the run's.
    for (let at = rows.length - 1; at >= 0; at -= 1) {
      const row = rows[at]!
      const handed = keyById.has(row.id)
        ? undefined
        : members[at]!.map((m) => keyByMember.get(m)).find((k) => k !== undefined && !taken.has(k))
      if (handed !== undefined) {
        take(row, handed)
      }
    }
  }
  for (const row of rows.filter((unkeyed) => !keyById.has(unkeyed.id))) {
    let key = row.id
    for (let n = 1; taken.has(key); n += 1) {
      key = `${row.id}~${n}`
    }
    take(row, key)
  }
  // A key no row kept names the first row now drawing one of its messages.
  const moved = new Map<string, string | undefined>()
  for (const key of keyByMember.values()) {
    if (!taken.has(key)) {
      moved.set(key, undefined)
    }
  }
  rows.forEach((row, at) => {
    for (const key of (members[at] ?? []).map((member) => keyByMember.get(member))) {
      if (key !== undefined && moved.has(key) && moved.get(key) === undefined) {
        moved.set(key, keyById.get(row.id))
      }
    }
  })
  return { keyById, moved }
}

/** Row keys for one shown chat, against the last committed render only, so what a key held dies
 *  with the rows that held it. */
export function useMobileNativeChatRowKeys(
  rows: readonly NativeChatMessage[],
  messages: readonly NativeChatMessage[],
  scope: string
): MobileNativeChatRowKeys {
  // Written at commit: a render React discards must not become the next one's last render.
  const committed = useRef<(Assigned & { scope: string }) | null>(null)
  const assigned = useMemo(() => {
    const previous = committed.current?.scope === scope ? committed.current : null
    return { scope, rows, messages, ...assignMobileNativeChatRowKeys(previous, rows, messages) }
  }, [rows, messages, scope])
  useLayoutEffect(() => {
    committed.current = assigned
  }, [assigned])
  return useMemo(
    () => ({
      sourceHead: assigned.messages[0]?.id,
      keyOf: (message: NativeChatMessage) => assigned.keyById.get(message.id) ?? message.id,
      current: (key: string) => (assigned.moved.has(key) ? assigned.moved.get(key) : key)
    }),
    [assigned]
  )
}
