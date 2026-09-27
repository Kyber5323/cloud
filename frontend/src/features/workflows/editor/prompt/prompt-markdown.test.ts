import { describe, expect, it } from 'vitest'
import {
  looksLikePromptMarkdown,
  promptMarkdownToContent,
} from '@/features/workflows/editor/prompt/prompt-markdown'

/** The parsed top-level blocks of a prompt string. */
function blocksOf(text: string) {
  const doc = promptMarkdownToContent(text)
  expect(doc.type).toBe('doc')
  return doc.content ?? []
}

describe('promptMarkdownToContent — block structure', () => {
  it('parses heading levels from leading hashes', () => {
    expect(blocksOf('# 标题')).toEqual([
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '标题' }] },
    ])
    expect(blocksOf('### h3')).toEqual([
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'h3' }] },
    ])
  })

  it('keeps a bare heading without trailing space as an empty heading', () => {
    expect(blocksOf('#')).toEqual([{ type: 'heading', attrs: { level: 1 }, content: [] }])
  })

  it('parses bullet and ordered lists into listItem paragraphs', () => {
    expect(blocksOf('- 一\n- 二')).toEqual([
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '一' }] }],
          },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '二' }] }],
          },
        ],
      },
    ])
    expect(blocksOf('1. one\n2. two')).toEqual([
      {
        type: 'orderedList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
          },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
          },
        ],
      },
    ])
  })

  it('parses a fenced code block with its language attribute', () => {
    expect(blocksOf('```ts\nconst x = 1\n```')).toEqual([
      {
        type: 'codeBlock',
        attrs: { language: 'ts' },
        content: [{ type: 'text', text: 'const x = 1' }],
      },
    ])
  })

  it('parses blockquote lines into one quote, preserving inner blanks', () => {
    expect(blocksOf('> 第一行\n> 第二行')).toEqual([
      {
        type: 'blockquote',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '第一行' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '第二行' }] },
        ],
      },
    ])
  })

  it('parses a horizontal rule as a leaf node', () => {
    expect(blocksOf('---')).toEqual([{ type: 'horizontalRule' }])
    expect(blocksOf('***')).toEqual([{ type: 'horizontalRule' }])
  })

  it('returns a single empty paragraph for an empty document', () => {
    expect(promptMarkdownToContent('')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    })
  })

  it('normalizes CRLF line endings before parsing', () => {
    expect(promptMarkdownToContent('一\r\n二').content?.[1]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: '二' }],
    })
  })
})

describe('promptMarkdownToContent — inline marks', () => {
  it('parses bold and italic wrappers into mark arrays', () => {
    expect(blocksOf('**粗** 和 *斜*')).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '粗', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' 和 ' },
          { type: 'text', text: '斜', marks: [{ type: 'italic' }] },
        ],
      },
    ])
  })

  it('parses strike and inline code wrappers', () => {
    expect(blocksOf('~~删~~ `码`')).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '删', marks: [{ type: 'strike' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: '码', marks: [{ type: 'code' }] },
        ],
      },
    ])
  })

  it('parses a shared star run as bold then italic opening', () => {
    expect(blocksOf('**a***b*')).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'a', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'b', marks: [{ type: 'italic' }] },
        ],
      },
    ])
  })

  it('restores a dot-qualified variable token to its atom', () => {
    expect(blocksOf('你好 {{#start.output#}}')).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '你好 ' },
          {
            type: 'promptToken',
            attrs: { kind: 'variable', name: 'start.output', label: '' },
          },
        ],
      },
    ])
  })

  it('leaves unsupported syntax as literal text', () => {
    const blocks = blocksOf('[链接](https://x) _下划线_ ==高亮== $skill')
    expect(blocks[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: '[链接](https://x) _下划线_ ==高亮== $skill' }],
    })
  })

  it('does not consume a bare underscore as italics', () => {
    expect(blocksOf('a_b_c')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'a_b_c' }] },
    ])
  })
})

describe('looksLikePromptMarkdown', () => {
  it('detects block and inline markdown surfaces', () => {
    expect(looksLikePromptMarkdown('# 标题')).toBe(true)
    expect(looksLikePromptMarkdown('- item')).toBe(true)
    expect(looksLikePromptMarkdown('> quote')).toBe(true)
    expect(looksLikePromptMarkdown('```')).toBe(true)
    expect(looksLikePromptMarkdown('**粗**')).toBe(true)
    expect(looksLikePromptMarkdown('plain text')).toBe(false)
    expect(looksLikePromptMarkdown('')).toBe(false)
  })
})
