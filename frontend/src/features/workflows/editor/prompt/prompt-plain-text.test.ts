import { getSchema } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { Node as PmNode } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import { promptMarkdownToContent } from '@/features/workflows/editor/prompt/prompt-markdown'
import {
  promptDocumentPlainText,
  promptInlineMarksPlainText,
} from '@/features/workflows/editor/prompt/prompt-plain-text'
import { PromptToken } from '@/features/workflows/editor/prompt/prompt-token'

const SCHEMA = getSchema([StarterKit, PromptToken])

/** Creates a schema mark instance, throwing when the test schema lacks it. */
function createMark(name: string) {
  const type = SCHEMA.marks[name]
  if (type === undefined) {
    throw new Error(`mark ${name} not registered`)
  }
  return type.create()
}

/** Parses Markdown into a document, then serializes it back out. */
function roundTrip(text: string): string {
  const doc = PmNode.fromJSON(SCHEMA, promptMarkdownToContent(text))
  return promptDocumentPlainText(doc)
}

/** A document already holding a promptToken, so serialization sees an atom. */
function tokenDoc(name: string): PmNode {
  return PmNode.fromJSON(SCHEMA, {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '值：' },
          { type: 'promptToken', attrs: { kind: 'variable', name } },
        ],
      },
    ],
  })
}

describe('promptDocumentPlainText round trip', () => {
  it('keeps plain paragraphs exactly as authored', () => {
    expect(roundTrip('你好 世界')).toBe('你好 世界')
  })

  it('wraps inline marks back in the serializer-specified delimiters', () => {
    expect(roundTrip('**粗** 和 *斜* 与 ~~删~~ 以及 `码`')).toBe(
      '**粗** 和 *斜* 与 ~~删~~ 以及 `码`',
    )
  })

  it('builds a documented heading, list, quote and fence, collapsing blank separators', () => {
    // Blank lines are just block separators, so they normalize to a single
    // newline between blocks; the block structure and inline content survive.
    expect(roundTrip('# 标题\n\n- 一\n- 二\n\n> 引用\n\n```ts\nconst x = 1\n```')).toBe(
      '# 标题\n- 一\n- 二\n> 引用\n```ts\nconst x = 1\n```',
    )
  })

  it('turns a horizontal rule back into its text marker', () => {
    expect(roundTrip('---')).toBe('---')
  })

  it('keeps unsupported literal syntax unchanged', () => {
    const source = '[链接](https://x) _一_ ==二== $skill'
    expect(roundTrip(source)).toBe(source)
  })

  it('serializes a variable token as its dotted selector text', () => {
    expect(promptDocumentPlainText(tokenDoc('agent.output'))).toBe('值：{{#agent.output#}}')
  })

  it('joins block boundaries with a single newline', () => {
    expect(roundTrip('第一段\n\n第二段')).toBe('第一段\n第二段')
  })

  it('serializes a code payload containing backticks without breaking the fence', () => {
    const inner = 'a ` b `` c'
    expect(roundTrip('```\n' + inner + '\n```')).toBe('```\n' + inner + '\n```')
  })
})

describe('promptInlineMarksPlainText', () => {
  it('prefers inline code over every other mark', () => {
    const bold = createMark('bold')
    const code = createMark('code')
    expect(promptInlineMarksPlainText('x', [bold, code])).toBe('`x`')
  })

  it('lengthens the code fence when the payload contains backticks', () => {
    const code = createMark('code')
    expect(promptInlineMarksPlainText('a`b', [code])).toBe('`` a`b ``')
  })

  it('wraps marks in the serializer-delimiter order', () => {
    const bold = createMark('bold')
    const italic = createMark('italic')
    const strike = createMark('strike')
    // Bold is applied last and outermost, folding onto the italic opener, so the
    // pair collapses into a shared `***` run that `takeWrapped` un-parses back.
    expect(promptInlineMarksPlainText('x', [strike, italic, bold])).toBe('***~~x~~***')
  })
})
