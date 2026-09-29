import type { NativeChatMessage } from './native-chat-types'

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

/** Same values `depth` objects down, identity below: re-deriving a row rebuilds its
 *  containers (a folded run's block list, an image turn's blocks) around unchanged values. */
function sameValues(left: object, right: object, depth: number): boolean {
  if (left === right) {
    return true
  }
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => {
      const a: unknown = Reflect.get(left, key)
      const b: unknown = Reflect.get(right, key)
      return (
        Object.hasOwn(right, key) &&
        (a === b || (depth > 0 && isObject(a) && isObject(b) && sameValues(a, b, depth - 1)))
      )
    })
  )
}

/** Hands back the previous call's row for every id whose values are unchanged, and the
 *  previous array when every row's are, so memoized renderers skip what a batch left alone. */
export function createNativeChatRowReuse<Row extends object>(
  depth: number
): (rows: Row[], idOf: (index: number) => string) => Row[] {
  let previous: Row[] = []
  let byId = new Map<string, Row>()
  return (rows, idOf) => {
    const next = rows.map((row, index) => {
      const prior = byId.get(idOf(index))
      return prior && sameValues(prior, row, depth) ? prior : row
    })
    if (next.length === previous.length && next.every((row, index) => row === previous[index])) {
      return previous
    }
    previous = next
    byId = new Map(next.map((row, index) => [idOf(index), row]))
    return next
  }
}

/** Transcript rows by message id, compared down to each block's fields. */
export function createNativeChatMessageReuse(): (
  messages: NativeChatMessage[]
) => NativeChatMessage[] {
  const reuse = createNativeChatRowReuse<NativeChatMessage>(2)
  return (messages) => reuse(messages, (index) => messages[index]!.id)
}
