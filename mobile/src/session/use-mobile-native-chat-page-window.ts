import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileNativeChatRowKeys } from './mobile-native-chat-row-keys'

/** Height assumed for a row before any row has been drawn. */
const FIRST_ESTIMATE = 80
/** Quiet time after the last scroll, with no finger down, that counts as at rest. A scroll write any
 *  sooner can land in iOS momentum, which it stops. */
const REST_MS = 150

/** The window's node: top spacer, the drawn rows, bottom spacer. */
export const MOBILE_NATIVE_CHAT_WINDOW_ID = 'chat-window'

type Box = { top: number; bottom: number }
type Measured = { getBoundingClientRect: () => Box }

/** The page's scrollable DOM node, as far as the window reads it. */
export type MobileNativeChatWindowScroller = Measured & {
  scrollTop: number
  clientHeight: number
  clientWidth: number
  querySelector: (selector: string) => { children: ArrayLike<Measured> } | null
  addEventListener: (type: string, listener: () => void, options: { passive: true }) => void
  removeEventListener: (type: string, listener: () => void) => void
}

type Win = {
  scope: string
  /** The first drawn row, and its index when committed: where the window stays once the key is gone. */
  first: string
  firstAt: number
  /** The last drawn row; null while the window reaches the end. */
  last: string | null
  lastAt: number
  /** The top spacer while parked; following derives it and the end pin holds the view. */
  top: number
  /** The first row before rows were drawn above it: their height comes out of the spacer. */
  absorb: string | null
}

type Live = {
  keys: readonly string[]
  start: number
  end: number
  top: number
  following: boolean
  viewport: number
  width: number
  scroller: () => MobileNativeChatWindowScroller | null | undefined
}

const height = (box: Box): number => box.bottom - box.top

/** Which rows the page draws: those near the screen, named by key so rows landing or trimmed around
 *  them never change which are drawn. The rest are two spacers. A move the reader didn't make is
 *  never written while they touch or scroll: what is drawn above them comes out of the top spacer,
 *  and a correction the spacer can't take waits until they are at rest. */
export function useMobileNativeChatPageWindow(args: {
  rows: readonly NativeChatMessage[]
  rowKeys: Pick<MobileNativeChatRowKeys, 'scope' | 'keyOf' | 'current'>
  following: boolean
  /** Changes when every row's height may: the font scale, the Tools toggle. */
  layoutKey: string
  scroller: () => MobileNativeChatWindowScroller | null | undefined
}): {
  start: number
  end: number
  top: number
  bottom: number
  /** Draws what the screen needs: after a scroll, or a resize the end pin has handled. */
  cover: () => void
  /** The place-hold's correction on the page. */
  keepInPlace: (drift: number) => void
  onScroll: () => void
} {
  const { rows, rowKeys, following, layoutKey, scroller } = args
  // The window is an external store: React renders its changes synchronously, before the next paint,
  // whether they come from a scroll, the resize observer or the rest timer.
  const store = useRef({ version: 0, notify: () => {} })
  const subscribe = useCallback((notify: () => void) => {
    store.current.notify = notify
    return () => {
      store.current.notify = () => {}
    }
  }, [])
  useSyncExternalStore(subscribe, () => store.current.version)
  const render = useCallback(() => {
    store.current.version += 1
    store.current.notify()
  }, [])
  const heights = useRef(new Map<string, number>())
  const measured = useRef({ sum: 0, count: 0, layoutKey })
  const w = useRef<Win | null>(null)
  const motion = useRef({
    touching: false,
    lastScroll: 0,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    owed: false,
    drift: 0,
    writeTo: null as number | null
  })
  const live = useRef<Live>({
    keys: [],
    start: 0,
    end: 0,
    top: 0,
    following,
    viewport: globalThis.innerHeight || 800,
    width: 0,
    scroller
  })

  const estimate = useCallback((key: string | undefined): number => {
    const { sum, count } = measured.current
    return heights.current.get(key ?? '') ?? (count > 0 ? sum / count : FIRST_ESTIMATE)
  }, [])
  const remember = useCallback((key: string | undefined, px: number) => {
    const was = key === undefined ? undefined : heights.current.get(key)
    if (key === undefined || was === px) {
      return
    }
    measured.current.sum += px - (was ?? 0)
    measured.current.count += was === undefined ? 1 : 0
    heights.current.set(key, px)
  }, [])
  const span = useCallback(
    (keys: readonly string[], from: number, to: number) => {
      let px = 0
      for (let at = from; at < to; at += 1) {
        px += estimate(keys[at])
      }
      return px
    },
    [estimate]
  )

  // This render's window.
  const keys = useMemo(() => rows.map(rowKeys.keyOf), [rows, rowKeys.keyOf])
  const indexOf = useMemo(() => new Map(keys.map((key, at) => [key, at])), [keys])
  const n = keys.length
  const viewport = live.current.viewport
  const at = (key: string, fallback: number): number =>
    indexOf.get(rowKeys.current(key) ?? '') ?? Math.max(0, Math.min(fallback, n - 1))
  const seatAtEnd = (): Win => {
    let first = n
    for (let filled = 0; first > 0 && filled < viewport; first -= 1) {
      filled += estimate(keys[first - 1])
    }
    const top = first > 0 ? span(keys, 0, first) + viewport : 0
    return { scope: rowKeys.scope, first: keys[first] ?? '', firstAt: first, last: null, lastAt: n - 1, top, absorb: null }
  }
  let win = w.current?.scope === rowKeys.scope ? w.current : seatAtEnd()
  let end = win.last === null ? n : at(win.last, win.lastAt) + 1
  if (following && win.last !== null) {
    // Following draws the end; from far up that is a new window there.
    win = end >= n ? { ...win, last: null } : seatAtEnd()
    end = n
  }
  const start = Math.min(at(win.first, win.firstAt), Math.max(0, end - 1))
  end = Math.min(n, Math.max(end, start + 1))
  const above = span(keys, 0, start)
  // Room to draw rows taller than estimated, kept while rows remain above; none at the top.
  const settled = start > 0 ? above + viewport : 0
  const top = following ? settled : Math.max(0, win.top)
  const bottom = span(keys, end, n)

  const atRest = (): boolean => {
    const m = motion.current
    return !m.touching && Date.now() - m.lastScroll >= REST_MS
  }
  const rest = useCallback(() => {
    const m = motion.current
    m.timer = undefined
    const wait = REST_MS - (Date.now() - m.lastScroll)
    if (m.touching) {
      return
    }
    if (wait > 0) {
      m.timer = setTimeout(rest, wait)
      return
    }
    m.owed = false
    // The commit settles what is owed, now that the reader is at rest.
    render()
  }, [render])
  const arm = useCallback(() => {
    const m = motion.current
    m.owed = true
    if (m.timer === undefined && !m.touching) {
      m.timer = setTimeout(rest, REST_MS)
    }
  }, [rest])

  /** Draws rows the screen is near and drops those far from it. True when the window changed. */
  const coverNow = useCallback(
    (): boolean => {
      const l = live.current
      const s = l.scroller()
      const node = s?.querySelector(`[data-testid="${MOBILE_NATIVE_CHAT_WINDOW_ID}"]`)
      const win = w.current
      const cells = node ? Array.from(node.children, (c) => c.getBoundingClientRect()).slice(1, -1) : []
      if (!s || !win || cells.length === 0) {
        return false
      }
      if (s.clientWidth !== l.width) {
        l.width = s.clientWidth
        heights.current.clear()
        measured.current = { ...measured.current, sum: 0, count: 0 }
      }
      const { keys, start, end, top, following } = l
      const n = keys.length
      cells.forEach((box, i) => remember(keys[start + i], height(box)))
      const view = s.getBoundingClientRect()
      const reach = (l.viewport = s.clientHeight)
      const firstTop = cells[0]!.top
      const lastBottom = cells[cells.length - 1]!.bottom
      const fill = (from: number): number => {
        let to = from
        for (let filled = 0; to < n && filled < reach; to += 1) {
          filled += estimate(keys[to])
        }
        return Math.max(to, from + 1)
      }
      let [first, last, nextTop, absorb] = [start, end, top, null as string | null]
      if (start > 0 && view.bottom <= firstTop && view.bottom > firstTop - top) {
        // Nothing drawn is on screen, so nothing needs to stay still: draw where the reader is.
        const scale = top / span(keys, 0, start)
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
          absorb = first < start && !following ? keys[start]! : null
        } else {
          while (first < end - 1 && cells[first - start]!.bottom < view.top - 2 * reach) {
            nextTop += following ? 0 : height(cells[first - start]!)
            first += 1
          }
        }
        if (end < n && lastBottom < view.bottom + reach) {
          for (let need = view.bottom + reach - lastBottom; last < n && need > 0; last += 1) {
            need -= estimate(keys[last])
          }
        } else {
          while (last - 1 > Math.max(first, start) && cells[last - 1 - start]!.top > view.bottom + 2 * reach) {
            last -= 1
          }
        }
      }
      if (first === start && last === end && nextTop === top) {
        return false
      }
      w.current = {
        ...win,
        first: keys[first]!,
        firstAt: first,
        last: last >= n ? null : keys[last - 1]!,
        lastAt: last - 1,
        top: nextTop,
        absorb
      }
      render()
      return true
    },
    [estimate, remember, span, render]
  )

  useLayoutEffect(() => {
    const m = motion.current
    const l = live.current
    if (w.current?.scope !== win.scope || measured.current.layoutKey !== layoutKey) {
      heights.current.clear()
      measured.current = { sum: 0, count: 0, layoutKey }
    }
    const last = end >= n ? null : keys[end - 1]!
    w.current = { ...win, first: keys[start] ?? '', firstAt: start, last, lastAt: end - 1, top, absorb: null }
    Object.assign(l, { keys, start, end, top, following, scroller })
    const s = scroller()
    if (!s || n === 0) {
      return
    }
    if (m.writeTo !== null) {
      s.scrollTop = m.writeTo
      m.writeTo = null
    }
    if (win.absorb !== null && !following) {
      // Rows drawn above the reader: the spacer gives up exactly their height, so nothing moves.
      const node = s.querySelector(`[data-testid="${MOBILE_NATIVE_CHAT_WINDOW_ID}"]`)
      const cells = node ? Array.from(node.children, (c) => c.getBoundingClientRect()).slice(1) : []
      const drawn = Math.min((indexOf.get(win.absorb) ?? start) - start, cells.length)
      let px = cells.slice(0, drawn).reduce((sum, box) => sum + height(box), 0)
      let cut = 0
      for (; cut < drawn && px > top; cut += 1) {
        // Taller than estimated and more than the spacer holds: it waits, undrawn, for rest.
        remember(keys[start + cut], height(cells[cut]!))
        px -= height(cells[cut]!)
      }
      w.current = { ...w.current, first: keys[start + cut]!, firstAt: start + cut, top: top - px }
      render()
      return
    }
    // The place-hold's correction: the spacer takes it if it can, else a write once at rest.
    if (!following && m.drift !== 0 && top - m.drift >= 0) {
      w.current.top = top - m.drift
      m.drift = 0
      render()
      return
    }
    if (following) {
      m.drift = 0
    }
    if (coverNow() || following) {
      return
    }
    const settle = start > 0 && top - above >= viewport / 2 ? 0 : settled - top
    if (m.drift === 0 && Math.abs(settle) < 0.5) {
      return
    }
    if (!atRest()) {
      arm()
      return
    }
    const to = s.scrollTop + m.drift + settle
    m.drift = 0
    if (Math.abs(settle) < 0.5) {
      s.scrollTop = to
      return
    }
    m.writeTo = to
    w.current.top = top + settle
    render()
  })

  useLayoutEffect(() => {
    const s = scroller()
    const m = motion.current
    const down = () => {
      m.touching = true
      clearTimeout(m.timer)
      m.timer = undefined
    }
    const up = () => {
      m.touching = false
      if (m.owed) {
        arm()
      }
    }
    s?.addEventListener('touchstart', down, { passive: true })
    s?.addEventListener('touchend', up, { passive: true })
    s?.addEventListener('touchcancel', up, { passive: true })
    return () => {
      s?.removeEventListener('touchstart', down)
      s?.removeEventListener('touchend', up)
      s?.removeEventListener('touchcancel', up)
      clearTimeout(m.timer)
    }
  }, [scroller, arm])

  const cover = useCallback(() => void coverNow(), [coverNow])
  const keepInPlace = useCallback((drift: number) => {
    motion.current.drift += drift
  }, [])
  const onScroll = useCallback(() => {
    motion.current.lastScroll = Date.now()
    coverNow()
  }, [coverNow])

  return { start, end, top, bottom, cover, keepInPlace, onScroll }
}
