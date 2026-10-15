import type { PageTouchEvent, PageTouches } from './mobile-native-chat-scroll-policy'

function hasPageTouches(event: object): event is PageTouches {
  return 'touches' in event
}

/** The elements the reader's touches on the page's list started on, while the browser still lists a
 *  touch on one. Why listen on the element, not the list: a touch whose element is removed
 *  mid-touch ends on that element alone, out of React's reach. */
export class PageTouchTargets {
  private readonly ends = new Map<EventTarget, (event: Event) => void>()

  get touching(): boolean {
    return this.ends.size > 0
  }

  /** A list touchstart: listens once per element for its touches' ends, `onEnd` running after
   *  each, and forgets elements the browser lists no touch on. */
  noteStart({ target, touches }: PageTouchEvent['nativeEvent'], onEnd: () => void): void {
    if (target instanceof EventTarget && !this.ends.has(target)) {
      const end = (event: Event) => {
        if (hasPageTouches(event)) {
          this.retire(event.touches)
          onEnd()
        }
      }
      target.addEventListener('touchend', end)
      target.addEventListener('touchcancel', end)
      this.ends.set(target, end)
    }
    this.retire(touches)
  }

  /** Stops listening to each element the browser no longer lists a touch on; `[]` releases all. */
  retire(touches: PageTouches['touches']): void {
    const live = new Set(Array.from(touches, (touch) => touch.target))
    for (const [target, end] of this.ends) {
      if (!live.has(target)) {
        target.removeEventListener('touchend', end)
        target.removeEventListener('touchcancel', end)
        this.ends.delete(target)
      }
    }
  }
}
