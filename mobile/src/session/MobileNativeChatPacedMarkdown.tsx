import type { ComponentProps } from 'react'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { withoutPendingNativeChatVisualDirectiveTail } from '../../../src/shared/native-chat-visual-directive'
import type { NativeChatReplyReveals } from '../../../src/shared/native-chat-reply-reveals'
import { useMobileNativeChatPacedText } from './use-mobile-native-chat-paced-text'

/** The agent's prose, drawn at a reading pace while it is being written. Its own component so
 *  a step of the pace re-renders the prose and nothing else in its row. */
export function MobileNativeChatPacedMarkdown({
  rowKey,
  text,
  streaming,
  replyReveals,
  renderVisual,
  ...props
}: Omit<ComponentProps<typeof MobileMarkdown>, 'content' | 'growing'> & {
  rowKey: string
  text: string
  streaming: boolean
  /** Only the block still being written gets its list's reveals; the rest draw whole. */
  replyReveals?: NativeChatReplyReveals
}): React.JSX.Element {
  const paced = useMobileNativeChatPacedText(rowKey, text, streaming, replyReveals)
  // A directive still being typed, or not yet revealed in full, is held back until it is whole.
  const holdVisual = renderVisual !== undefined && (streaming || paced.revealing)
  return (
    <MobileMarkdown
      {...props}
      content={holdVisual ? withoutPendingNativeChatVisualDirectiveTail(paced.text) : paced.text}
      renderVisual={renderVisual}
      growing={paced.revealing}
    />
  )
}
