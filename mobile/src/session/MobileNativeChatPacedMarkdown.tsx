import type { ComponentProps } from 'react'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { withoutPendingNativeChatVisualDirectiveTail } from '../../../src/shared/native-chat-visual-directive'
import { useMobileNativeChatPacedText } from './use-mobile-native-chat-paced-text'

/** The agent's prose, drawn at a reading pace while it is being written. Its own component so
 *  a step of the pace re-renders the prose and nothing else in its row. */
export function MobileNativeChatPacedMarkdown({
  rowKey,
  text,
  streaming,
  paced,
  renderVisual,
  ...props
}: Omit<ComponentProps<typeof MobileMarkdown>, 'content' | 'growing'> & {
  rowKey: string
  text: string
  streaming: boolean
  /** Only the block that can still be written is paced and remembered; the rest draw whole. */
  paced: boolean
}): React.JSX.Element {
  const shown = useMobileNativeChatPacedText(rowKey, text, streaming, paced)
  // A directive still being typed, or not yet revealed in full, is held back until it is whole.
  const holdVisual = renderVisual !== undefined && (streaming || shown.revealing)
  return (
    <MobileMarkdown
      {...props}
      content={holdVisual ? withoutPendingNativeChatVisualDirectiveTail(shown.text) : shown.text}
      renderVisual={renderVisual}
      growing={shown.revealing}
    />
  )
}
