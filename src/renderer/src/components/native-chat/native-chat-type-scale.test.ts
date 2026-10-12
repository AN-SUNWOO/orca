import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  resolve('src/renderer/src/components/native-chat/native-chat-appearance.css'),
  'utf8'
)
const rootRule = /\.native-chat-appearance \{([^}]*)\}/.exec(css)?.[1] ?? ''

function declared(name: string): string {
  return new RegExp(`${name}:\\s*([^;]+);`).exec(rootRule)?.[1] ?? ''
}

describe('chat type scale', () => {
  it('sizes the reading step from the text size setting', () => {
    expect(declared('--text-sm')).toContain('var(--chat-font-size')
  })

  // Labels and controls follow the chat's own size, which only differs from --text-sm when matching a terminal.
  it('sizes labels and controls from the bounded chat size, falling back to the reading step', () => {
    expect(declared('--chat-ui-size')).toContain('var(--chat-ui-font-size')
    expect(declared('--chat-ui-size')).toContain('var(--text-sm)')
  })

  // A step that stops deriving from the chat size stays fixed while the setting moves the rest.
  it.each(['--text-xs', '--text-2xs', '--text-3xs'])('scales %s with the chat size', (step) => {
    expect(declared(step)).toContain('var(--chat-ui-size)')
  })

  // Labels never outgrow the message text when a small terminal size is matched.
  it.each(['--text-xs', '--text-2xs'])('caps %s at the reading step', (step) => {
    expect(declared(step)).toMatch(/^min\(var\(--text-sm\),/)
  })

  it('scales spacing and icons with the chat size', () => {
    expect(declared('--spacing')).toContain('var(--chat-ui-size)')
  })

  it('sizes code from the code text size setting', () => {
    expect(declared('--text-chat-code')).toContain('var(--chat-code-font-size')
  })
})
