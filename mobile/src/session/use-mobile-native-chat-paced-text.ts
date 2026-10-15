import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  playNativeChatTextReveal,
  receiveNativeChatText,
  startNativeChatTextReveal,
  type NativeChatTextRevealFrames
} from '../../../src/shared/native-chat-text-reveal'
import type { NativeChatReplyReveals } from '../../../src/shared/native-chat-reply-reveals'
import { MobileNativeChatReducedMotionContext } from './mobile-native-chat-reply-reveals'

const FRAMES: NativeChatTextRevealFrames = {
  now: () => performance.now(),
  request: (step) => requestAnimationFrame(step),
  cancel: (frame) => cancelAnimationFrame(frame)
}

export type MobileNativeChatPacedText = { text: string; revealing: boolean }

/** How much of a reply to draw now. Without its list, or with reduced motion, all of it. */
export function useMobileNativeChatPacedText(
  rowKey: string,
  text: string,
  streaming: boolean,
  list: NativeChatReplyReveals | undefined
): MobileNativeChatPacedText {
  const immediate = useContext(MobileNativeChatReducedMotionContext) || list === undefined
  const [initial] = useState(() =>
    startNativeChatTextReveal(
      text,
      streaming,
      list?.drawn.get(rowKey),
      list?.begun.has(rowKey) === true,
      FRAMES.now()
    )
  )
  const pace = useRef(initial)
  const [shown, setShown] = useState(initial.shown)

  useLayoutEffect(() => {
    pace.current = receiveNativeChatText(pace.current, text, streaming, immediate, FRAMES.now())
    setShown(pace.current.shown)
    list?.drawn.set(rowKey, pace.current)
  }, [text, streaming, immediate, list, rowKey])

  const behind = !immediate && shown < text.length
  useEffect(() => {
    if (!behind) {
      if (!streaming) {
        list?.drawn.delete(rowKey)
      }
      return
    }
    return playNativeChatTextReveal(
      () => pace.current,
      (next) => {
        pace.current = next
        list?.drawn.set(rowKey, next)
        setShown(next.shown)
      },
      FRAMES
    )
  }, [behind, text, list, rowKey, streaming])

  return immediate
    ? { text, revealing: false }
    : { text: text.slice(0, Math.min(shown, text.length)), revealing: streaming || behind }
}
