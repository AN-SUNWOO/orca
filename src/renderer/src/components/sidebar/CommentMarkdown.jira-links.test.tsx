import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { adfToMarkdownText } from '../../../../main/jira/adf-markdown'
import CommentMarkdown from './CommentMarkdown'

function renderAdf(adf: unknown): string {
  return renderToStaticMarkup(
    <CommentMarkdown content={adfToMarkdownText(adf)} variant="document" />
  )
}

describe('CommentMarkdown Jira ADF links', () => {
  it('keeps punctuation immediately before a link from turning it into an image', () => {
    const markup = renderAdf({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Important!' },
        {
          type: 'text',
          text: 'Design spec',
          marks: [{ type: 'link', attrs: { href: 'https://example.com/spec' } }]
        }
      ]
    })
    expect(markup).toContain('href="https://example.com/spec"')
    expect(markup).not.toContain('<img')
  })

  it.each(['`edge`', '  padded  ', '[bracket] <b>literal</b>', 'cost &amp; unit'])(
    'preserves the literal linked label %s',
    (text) => {
      const content = adfToMarkdownText({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text,
            marks: [{ type: 'link', attrs: { href: 'https://example.com/spec' } }]
          }
        ]
      })
      const markup = renderToStaticMarkup(<CommentMarkdown content={content} variant="document" />)
      expect(markup).toContain('href="https://example.com/spec"')
      expect(markup).not.toContain('<b>literal</b>')
      expect(markup).toContain(
        text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      )
    }
  )

  it('preserves code labels with backticks at either edge', () => {
    const markup = renderAdf({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: '`edge`',
          marks: [{ type: 'code' }, { type: 'link', attrs: { href: 'https://example.com/code' } }]
        }
      ]
    })
    expect(markup).toContain('>`edge`</code></a>')
  })

  it('does not allow a link label to introduce HTML or a second link', () => {
    const markup = renderAdf({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: '<a href="https://evil.example">x</a> ](https://evil.example)',
          marks: [{ type: 'link', attrs: { href: 'https://example.com/spec' } }]
        }
      ]
    })
    expect(markup.match(/<a /g)).toHaveLength(1)
    expect(markup).not.toContain('href="https://evil.example"')
  })

  it('keeps marked labels intact when rendered as HTML', () => {
    const markup = renderAdf({
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'cost ` per unit',
              marks: [{ type: 'link', attrs: { href: 'https://example.com/backtick' } }]
            },
            { type: 'text', text: ' see `here`' }
          ]
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'a*b',
              marks: [
                { type: 'strong' },
                { type: 'link', attrs: { href: 'https://example.com/star' } }
              ]
            },
            { type: 'text', text: ' ]' }
          ]
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'bracket [label] ]',
              marks: [{ type: 'link', attrs: { href: 'https://example.com/brackets' } }]
            }
          ]
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'line\n\nbreak ]',
              marks: [{ type: 'link', attrs: { href: 'https://example.com/newline' } }]
            }
          ]
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'cost ` per unit',
              marks: [
                { type: 'code' },
                { type: 'link', attrs: { href: 'https://example.com/code' } }
              ]
            }
          ]
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'list link',
                      marks: [{ type: 'link', attrs: { href: 'https://example.com/list' } }]
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'quote link',
                  marks: [{ type: 'link', attrs: { href: 'https://example.com/quote' } }]
                }
              ]
            }
          ]
        }
      ]
    })

    expect(markup).toContain('href="https://example.com/backtick"')
    expect(markup).toContain('>cost ` per unit</a>')
    expect(markup).toContain('href="https://example.com/star"')
    expect(markup).toContain('><strong>a*b</strong></a>')
    expect(markup).toContain('href="https://example.com/newline"')
    expect(markup).toContain('>line  break ]</a>')
    expect(markup).toContain('href="https://example.com/brackets"')
    expect(markup).toContain('>bracket [label] ]</a>')
    expect(markup).toContain('href="https://example.com/code"')
    expect(markup).toContain('>cost ` per unit</code></a>')
    expect(markup).toContain('href="https://example.com/list"')
    expect(markup).toContain('href="https://example.com/quote"')
  })
})
