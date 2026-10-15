export type MobileNativeChatBox = { top: number; bottom: number }

export const boxHeight = (box: MobileNativeChatBox): number => box.bottom - box.top

/** The window as drawn: rows `[start, end)` of `keys`, below a top spacer `top` px tall. */
export type MobileNativeChatWindowExtent = {
  keys: readonly string[]
  start: number
  end: number
  top: number
  following: boolean
}

type Estimate = (key: string | undefined) => number

export function mobileNativeChatSpan(
  keys: readonly string[],
  from: number,
  to: number,
  estimate: Estimate
): number {
  let px = 0
  for (let at = from; at < to; at += 1) {
    px += estimate(keys[at])
  }
  return px
}

/** Draws rows within one screen (`reach`) of it and drops rows past two; null when nothing changes.
 *  `absorb`: rows were drawn above the reader, so their height comes out of the top spacer. */
export function coverMobileNativeChatWindow(
  { keys, start, end, top, following }: MobileNativeChatWindowExtent,
  cells: readonly MobileNativeChatBox[],
  view: MobileNativeChatBox,
  reach: number,
  estimate: Estimate
): { first: number; last: number; top: number; absorb: boolean } | null {
  const n = keys.length
  const firstTop = cells[0]!.top
  const lastBottom = cells[cells.length - 1]!.bottom
  const fill = (from: number): number => {
    let to = from
    for (let filled = 0; to < n && filled < reach; to += 1) {
      filled += estimate(keys[to])
    }
    return Math.max(to, from + 1)
  }
  let [first, last, nextTop, absorb] = [start, end, top, false]
  if (start > 0 && view.bottom <= firstTop && view.bottom > firstTop - top) {
    // Nothing drawn is on screen, so nothing needs to stay still: draw where the reader is.
    const scale = top / mobileNativeChatSpan(keys, 0, start, estimate)
    const y = Math.max(0, view.top - (firstTop - top))
    for (first = 0, nextTop = 0; first < start - 1; first += 1) {
      const px = estimate(keys[first]) * scale
      if (nextTop + px > y) {
        break
      }
      nextTop += px
    }
    last = fill(first)
  } else if (end < n && view.top >= lastBottom) {
    let y = view.top - lastBottom
    for (first = end, nextTop = lastBottom - (firstTop - top); first < n - 1; first += 1) {
      if (y < estimate(keys[first])) {
        break
      }
      y -= estimate(keys[first])
      nextTop += estimate(keys[first])
    }
    last = fill(first)
  } else {
    if (start > 0 && firstTop > view.top - reach) {
      // Parked, only what the spacer can give up: a row it can't would move the reader.
      let room = following ? Infinity : top
      for (let need = firstTop - (view.top - reach); first > 0 && need > 0; first -= 1) {
        const px = estimate(keys[first - 1])
        if (px > room) {
          break
        }
        room -= px
        need -= px
      }
      absorb = first < start && !following
    } else {
      while (first < end - 1 && cells[first - start]!.bottom < view.top - 2 * reach) {
        nextTop += following ? 0 : boxHeight(cells[first - start]!)
        first += 1
      }
    }
    if (end < n && lastBottom < view.bottom + reach) {
      for (let need = view.bottom + reach - lastBottom; last < n && need > 0; last += 1) {
        need -= estimate(keys[last])
      }
    } else {
      const far = view.bottom + 2 * reach
      while (last - 1 > Math.max(first, start) && cells[last - 1 - start]!.top > far) {
        last -= 1
      }
    }
  }
  return first === start && last === end && nextTop === top
    ? null
    : { first, last, top: nextTop, absorb }
}
