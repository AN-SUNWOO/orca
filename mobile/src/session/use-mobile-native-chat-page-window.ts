import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileNativeChatRowKeys } from './mobile-native-chat-row-keys'
import {
  boxHeight,
  coverMobileNativeChatWindow,
  mobileNativeChatSpan,
  type MobileNativeChatBox,
  type MobileNativeChatWindowExtent
} from './mobile-native-chat-page-window-coverage'

/** Height assumed for a row before any row has been drawn. */
const FIRST_ESTIMATE = 80
/** Quiet time after the last scroll, with no finger down, that counts as at rest. A scroll write any
 *  sooner can land in iOS momentum, which it stops. */
const REST_MS = 150

/** The window's node: top spacer, the drawn rows, bottom spacer. */
export const MOBILE_NATIVE_CHAT_WINDOW_ID = 'chat-window'

type Measured = { getBoundingClientRect: () => MobileNativeChatBox }

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

type Motion = {
  touching: boolean
  lastScroll: number
  timer: ReturnType<typeof setTimeout> | undefined
  /** A correction or settle waits for rest. */
  owed: boolean
  /** The place-hold's correction not yet made. */
  drift: number
  /** A scroll offset to write once the spacer change it goes with is in the document. */
  writeTo: number | null
}

/** The drawn rows' boxes, then the bottom spacer's. */
function drawnBoxes(scroller: MobileNativeChatWindowScroller): MobileNativeChatBox[] {
  const node = scroller.querySelector(`[data-testid="${MOBILE_NATIVE_CHAT_WINDOW_ID}"]`)
  return node ? Array.from(node.children, (c) => c.getBoundingClientRect()).slice(1) : []
}

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
  /** Draws what the screen needs: after a resize the end pin has handled. */
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
  const measured = useRef({ sum: 0, count: 0, layoutKey, width: 0 })
  const w = useRef<Win | null>(null)
  // What the last commit drew, for the passes that run outside a render.
  const drawn = useRef<MobileNativeChatWindowExtent>({
    keys: [],
    start: 0,
    end: 0,
    top: 0,
    following
  })
  const viewport = useRef(globalThis.innerHeight || 800)
  const motion = useRef<Motion>({
    touching: false,
    lastScroll: 0,
    timer: undefined,
    owed: false,
    drift: 0,
    writeTo: null
  })

  const estimate = useCallback((key: string | undefined): number => {
    const { sum, count } = measured.current
    return heights.current.get(key ?? '') ?? (count > 0 ? sum / count : FIRST_ESTIMATE)
  }, [])
  const remember = useCallback((key: string | undefined, px: number) => {
    const was = key === undefined ? undefined : heights.current.get(key)
    if (key !== undefined && was !== px) {
      measured.current.sum += px - (was ?? 0)
      measured.current.count += was === undefined ? 1 : 0
      heights.current.set(key, px)
    }
  }, [])
  const forget = useCallback((next: { layoutKey?: string; width?: number }) => {
    heights.current.clear()
    measured.current = { ...measured.current, ...next, sum: 0, count: 0 }
  }, [])

  // This render's window.
  const keys = useMemo(() => rows.map(rowKeys.keyOf), [rows, rowKeys.keyOf])
  const indexOf = useMemo(() => new Map(keys.map((key, at) => [key, at])), [keys])
  const n = keys.length
  const screen = viewport.current
  const at = (key: string, fallback: number): number =>
    indexOf.get(rowKeys.current(key) ?? '') ?? Math.max(0, Math.min(fallback, n - 1))
  const seatAtEnd = (): Win => {
    let first = n
    for (let filled = 0; first > 0 && filled < screen; first -= 1) {
      filled += estimate(keys[first - 1])
    }
    const top = first > 0 ? mobileNativeChatSpan(keys, 0, first, estimate) + screen : 0
    const { scope } = rowKeys
    return {
      scope,
      first: keys[first] ?? '',
      firstAt: first,
      last: null,
      lastAt: n - 1,
      top,
      absorb: null
    }
  }
  // A chat opens at its end, and so do rows arriving where there were none.
  const kept = w.current?.scope === rowKeys.scope && w.current.first !== ''
  let win = kept && w.current ? w.current : seatAtEnd()
  let end = win.last === null ? n : at(win.last, win.lastAt) + 1
  if (following && win.last !== null) {
    // Following draws the end; from far up that is a new window there.
    win = end >= n ? { ...win, last: null } : seatAtEnd()
    end = n
  }
  const start = Math.min(at(win.first, win.firstAt), Math.max(0, end - 1))
  end = Math.min(n, Math.max(end, start + 1))
  const above = mobileNativeChatSpan(keys, 0, start, estimate)
  // Room to draw rows taller than estimated, kept while rows remain above; none at the top.
  const settled = start > 0 ? above + screen : 0
  const top = following ? settled : Math.max(0, win.top)
  const bottom = mobileNativeChatSpan(keys, end, n, estimate)

  const atRest = (): boolean =>
    !motion.current.touching && Date.now() - motion.current.lastScroll >= REST_MS
  const rest = useCallback(() => {
    const m = motion.current
    const wait = REST_MS - (Date.now() - m.lastScroll)
    m.timer = m.touching || wait <= 0 ? undefined : setTimeout(rest, wait)
    if (!m.touching && wait <= 0) {
      m.owed = false
      // The commit settles what is owed, now that the reader is at rest.
      render()
    }
  }, [render])
  const arm = useCallback(() => {
    const m = motion.current
    m.owed = true
    if (m.timer === undefined && !m.touching) {
      m.timer = setTimeout(rest, REST_MS)
    }
  }, [rest])

  /** Draws rows the screen is near and drops those far from it. True when the window changed. */
  const cover = useCallback((): boolean => {
    const d = drawn.current
    const s = scroller()
    const cells = s ? drawnBoxes(s).slice(0, -1) : []
    if (!s || !w.current || cells.length === 0) {
      return false
    }
    if (s.clientWidth !== measured.current.width) {
      forget({ width: s.clientWidth })
    }
    cells.forEach((box, i) => remember(d.keys[d.start + i], boxHeight(box)))
    viewport.current = s.clientHeight
    const next = coverMobileNativeChatWindow(
      d,
      cells,
      s.getBoundingClientRect(),
      s.clientHeight,
      estimate
    )
    if (!next) {
      return false
    }
    const last = next.last >= d.keys.length ? null : d.keys[next.last - 1]!
    w.current = {
      ...w.current,
      first: d.keys[next.first]!,
      firstAt: next.first,
      last,
      lastAt: next.last - 1,
      top: next.top,
      absorb: next.absorb ? d.keys[d.start]! : null
    }
    render()
    return true
  }, [estimate, forget, remember, render, scroller])

  useLayoutEffect(() => {
    const m = motion.current
    if (w.current?.scope !== win.scope || measured.current.layoutKey !== layoutKey) {
      forget({ layoutKey })
    }
    const last = end >= n ? null : keys[end - 1]!
    w.current = {
      ...win,
      first: keys[start] ?? '',
      firstAt: start,
      last,
      lastAt: end - 1,
      top,
      absorb: null
    }
    drawn.current = { keys, start, end, top, following }
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
      const cells = drawnBoxes(s)
      const added = Math.min((indexOf.get(win.absorb) ?? start) - start, cells.length)
      let px = cells.slice(0, added).reduce((sum, box) => sum + boxHeight(box), 0)
      let cut = 0
      for (; cut < added && px > top; cut += 1) {
        // Taller than estimated and more than the spacer holds: it waits, undrawn, for rest.
        remember(keys[start + cut], boxHeight(cells[cut]!))
        px -= boxHeight(cells[cut]!)
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
    m.drift = following ? 0 : m.drift
    if (cover() || following) {
      return
    }
    const settle = start > 0 && top - above >= screen / 2 ? 0 : settled - top
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
    const listeners = [
      ['touchstart', down],
      ['touchend', up],
      ['touchcancel', up]
    ] as const
    listeners.forEach(([type, listener]) => s?.addEventListener(type, listener, { passive: true }))
    return () => {
      listeners.forEach(([type, listener]) => s?.removeEventListener(type, listener))
      clearTimeout(m.timer)
    }
  }, [scroller, arm])

  const keepInPlace = useCallback((drift: number) => {
    motion.current.drift += drift
  }, [])
  const onScroll = useCallback(() => {
    motion.current.lastScroll = Date.now()
    cover()
  }, [cover])
  const coverAfterResize = useCallback(() => void cover(), [cover])

  return { start, end, top, bottom, cover: coverAfterResize, keepInPlace, onScroll }
}
