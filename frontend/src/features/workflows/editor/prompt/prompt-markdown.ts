import type { JSONContent } from '@tiptap/core'

/**
 * Turns the Markdown surface the prompt editor produces into Tiptap JSON.
 *
 * This is a strict inverse of `promptDocumentPlainText`: every node the parser
 * builds is exactly what the serializer re-emits, so an open-close round trip
 * of the stored `prompt` string is lossless. Anything outside the subset —
 * links, task items, `==highlight==`, `_underscore_` italics, `$skill` tokens —
 * deliberately stays literal text, which still round-trips unchanged.
 */

type MarkSpec = { type: string; attrs?: Record<string, string | null> }

const HEADING = /^(#{1,6})(?:\s+|$)(.*)$/
const BULLET = /^(\s*)[-*+]\s+(.*)$/
const ORDERED = /^(\s*)(\d+)\.\s+(.*)$/
const FENCE = /^(```+)([^\s`]*)$/
const RULE = /^(?:---|\*\*\*|___)\s*$/
const INLINE_WRAPPED =
  /(\*\*\*(?!\s)[^*]+(?<!\s)\*\*\*|\*\*(?!\s)[^*]+(?<!\s)\*\*|~~(?!\s)[^~]+(?<!\s)~~|(?<!\*)\*(?![*\s])[^*]+(?<!\s)\*(?!\*))/

/** CommonMark: a closing fence is a line of backticks at least as long as the opener. */
function isFenceClose(line: string, openLen: number): boolean {
  const match = /^(```+)$/.exec(line)
  return match !== null && (match[1]?.length ?? 0) >= openLen
}

/** Prompt pastes are small; cap quote recursion so `>>>>>>>>>…` cannot blow the stack. */
const MAX_QUOTE_DEPTH = 32

/** Whether clipboard text looks like the prompt's Markdown surface. */
export function looksLikePromptMarkdown(text: string): boolean {
  if (text.length === 0) {
    return false
  }
  return (
    /^(#{1,6}\s|\s*[-*+]\s|\s*\d+\.\s|>\s|```|---|___|\*\*\*)/m.test(text) ||
    INLINE_WRAPPED.test(text)
  )
}

/** Parses the prompt string into a top-level Tiptap document. */
export function promptMarkdownToContent(text: string): JSONContent {
  const blocks = parseBlocks(text.replace(/\r\n/g, '\n').split('\n'))
  return {
    type: 'doc',
    content: blocks.length === 0 ? [{ type: 'paragraph' }] : blocks,
  }
}

/** One parsed block plus the index the scan reaches past it. */
interface BlockScan {
  node: JSONContent
  next: number
}

function parseBlocks(lines: string[], quoteDepth = 0): JSONContent[] {
  const blocks: JSONContent[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (line === undefined) {
      break
    }

    const scan: BlockScan | null = scanBlockAt(lines, index, quoteDepth, line)
    if (scan !== null) {
      blocks.push(scan.node)
      index = scan.next
      continue
    }

    if (line.length === 0) {
      index += 1
      continue
    }

    blocks.push(paragraph(line))
    index += 1
  }

  return blocks
}

/**
 * Dispatches one line to its block handler; `null` means the caller should
 * fall through to the plain-paragraph branch. Each handler owns one construct
 * so the loop above stays a flat dispatch.
 */
function scanBlockAt(
  lines: string[],
  index: number,
  quoteDepth: number,
  line: string,
): BlockScan | null {
  const fence = FENCE.exec(line)
  if (fence !== null) {
    return scanFence(lines, index, fence)
  }

  if (RULE.test(line) && line.trim().length > 0) {
    return { node: { type: 'horizontalRule' }, next: index + 1 }
  }

  const heading = HEADING.exec(line)
  if (heading !== null) {
    return {
      node: {
        type: 'heading',
        attrs: { level: heading[1]?.length ?? 1 },
        content: parseInline(heading[2] ?? ''),
      },
      next: index + 1,
    }
  }

  if (line.startsWith('>')) {
    return scanQuote(lines, index, quoteDepth)
  }

  if (BULLET.test(line) || ORDERED.test(line)) {
    return parseList(lines, index)
  }

  return null
}

/** Eats a fenced code block, whose body is every line up to a matching close. */
function scanFence(lines: string[], index: number, fence: RegExpExecArray): BlockScan {
  const openTicks = fence[1] ?? '```'
  const language = fence[2] === '' ? null : (fence[2] ?? null)
  const body: string[] = []
  let cursor = index + 1
  while (cursor < lines.length && !isFenceClose(lines[cursor] ?? '', openTicks.length)) {
    body.push(lines[cursor] ?? '')
    cursor += 1
  }
  if (cursor < lines.length && isFenceClose(lines[cursor] ?? '', openTicks.length)) {
    cursor += 1
  }
  return { node: codeBlock(language, body.join('\n')), next: cursor }
}

/** Eats one `>` quote run, capping recursion depth so `>>>>>>…` cannot blow the stack. */
function scanQuote(lines: string[], index: number, quoteDepth: number): BlockScan {
  if (quoteDepth >= MAX_QUOTE_DEPTH) {
    return { node: paragraph(lines[index] ?? ''), next: index + 1 }
  }
  const quoted = parseQuoteRun(lines, index, quoteDepth)
  return {
    node: {
      type: 'blockquote',
      content: quoted.inner.length === 0 ? [{ type: 'paragraph' }] : quoted.inner,
    },
    next: quoted.next,
  }
}

/**
 * Consecutive `>` lines are one quote. Peel a single marker and parse the
 * rest as blocks so `> >` nests and `> - item` becomes a list inside.
 */
function parseQuoteRun(
  lines: string[],
  start: number,
  quoteDepth: number,
): { inner: JSONContent[]; next: number } {
  const peeled: string[] = []
  let index = start
  while (index < lines.length) {
    const line = lines[index]
    if (line === undefined || !line.startsWith('>')) {
      break
    }
    peeled.push(line.startsWith('> ') ? line.slice(2) : line.slice(1))
    index += 1
  }
  return { inner: parseBlocks(peeled, quoteDepth + 1), next: index }
}

function paragraph(text: string): JSONContent {
  const content = parseInline(text)
  return content.length === 0 ? { type: 'paragraph' } : { type: 'paragraph', content }
}

function codeBlock(language: string | null, text: string): JSONContent {
  const node: JSONContent = {
    type: 'codeBlock',
    attrs: { language },
  }
  if (text.length > 0) {
    node.content = [{ type: 'text', text }]
  }
  return node
}

function parseList(lines: string[], start: number): { node: JSONContent; next: number } {
  const first = lines[start] ?? ''
  const isOrdered = ORDERED.test(first)
  const items: JSONContent[] = []
  let index = start

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const bullet = BULLET.exec(line)
    const ordered = ORDERED.exec(line)
    if (isOrdered) {
      if (ordered === null) {
        break
      }
      items.push({
        type: 'listItem',
        content: [paragraph(ordered[3] ?? '')],
      })
      index += 1
      continue
    }
    if (bullet === null) {
      break
    }
    items.push({
      type: 'listItem',
      content: [paragraph(bullet[2] ?? '')],
    })
    index += 1
  }

  return {
    node: {
      type: isOrdered ? 'orderedList' : 'bulletList',
      content: items,
    },
    next: index,
  }
}

/**
 * Parses leftover source from the start of each remainder so a shared `***`
 * run can close bold and then open italic (`**a***b*`) without seeing the
 * already-consumed stars as part of the next opener.
 */
function parseInline(text: string): JSONContent[] {
  const nodes: JSONContent[] = []
  let rest = text

  while (rest.length > 0) {
    const inlineCode = takeInlineCode(rest)
    if (inlineCode !== null) {
      pushText(nodes, inlineCode.inner, [{ type: 'code' }])
      rest = rest.slice(inlineCode.end)
      continue
    }

    const prompt = takePromptToken(rest)
    if (prompt !== null) {
      nodes.push(prompt.node)
      rest = rest.slice(prompt.end)
      continue
    }

    const wrapped = takeWrapped(rest, 0)
    if (wrapped !== null) {
      let inner = parseInline(wrapped.inner)
      for (const mark of wrapped.marks) {
        inner = withMark(inner, mark)
      }
      nodes.push(...inner)
      rest = rest.slice(wrapped.end)
      continue
    }

    const next = nextSpecial(rest, 1)
    pushText(nodes, rest.slice(0, next), [])
    rest = rest.slice(next)
  }

  return nodes
}

/**
 * Restores a `{{#selector#}}` variable token from plain text. The selector
 * must be dot-qualified (`node.name`), mirroring what workflow prompts insert.
 */
function takePromptToken(text: string): { node: JSONContent; end: number } | null {
  const variableMatch = /^\{\{#([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)#\}\}/.exec(text)
  if (variableMatch === null) {
    return null
  }
  return {
    node: {
      type: 'promptToken',
      attrs: {
        kind: 'variable',
        name: variableMatch[1] ?? '',
        label: '',
      },
    },
    end: variableMatch[0].length,
  }
}

/**
 * CommonMark inline code: a run of opening backticks closed by the same
 * number, not as part of a longer run. One leading/trailing space is padding
 * so a payload that starts with a backtick can still round-trip.
 */
function takeInlineCode(text: string): { inner: string; end: number } | null {
  if (text[0] !== '`') {
    return null
  }
  let ticks = 0
  while (text[ticks] === '`') {
    ticks += 1
  }
  let index = ticks
  while (index < text.length) {
    if (text[index] !== '`') {
      index += 1
      continue
    }
    let run = 0
    while (text[index + run] === '`') {
      run += 1
    }
    if (run === ticks) {
      let inner = text.slice(ticks, index)
      if (inner.length >= 2 && inner.startsWith(' ') && inner.endsWith(' ')) {
        inner = inner.slice(1, -1)
      }
      return { inner, end: index + ticks }
    }
    index += run
  }
  return null
}

/**
 * Longest delimiter first, then the nearest closer. Extra stars after a
 * closer stay on the remainder (`**bold***em*`) which parseInline slices off.
 * The delimiter table is exactly the serializer's wrap order, so no delimiter
 * that is not produced can be silently consumed.
 */
function takeWrapped(
  text: string,
  index: number,
): { inner: string; marks: MarkSpec[]; end: number } | null {
  const delimiters: Array<{ token: string; marks: MarkSpec[] }> = [
    { token: '***', marks: [{ type: 'italic' }, { type: 'bold' }] },
    { token: '**', marks: [{ type: 'bold' }] },
    { token: '~~', marks: [{ type: 'strike' }] },
    { token: '*', marks: [{ type: 'italic' }] },
  ]
  for (const delimiter of delimiters) {
    if (!gfmCanOpen(text, index, delimiter.token)) {
      continue
    }
    const start = index + delimiter.token.length
    const close = text.indexOf(delimiter.token, start)
    if (close > start && gfmCanClose(text, close)) {
      return {
        inner: text.slice(start, close),
        marks: delimiter.marks,
        end: close + delimiter.token.length,
      }
    }
  }
  return null
}

/**
 * Same flanking as the prose marks: no space after the opener or before the
 * closer, and an opener never starts in the middle of a longer run.
 */
function gfmCanOpen(text: string, index: number, token: string): boolean {
  if (!text.startsWith(token, index)) {
    return false
  }
  const next = text[index + token.length]
  if (next !== undefined && /\s/.test(next)) {
    return false
  }
  if (token === '***' || token === '**' || token === '*') {
    if (index > 0 && text[index - 1] === '*') {
      return false
    }
    if (next === '*') {
      return false
    }
  }
  return true
}

function gfmCanClose(text: string, close: number): boolean {
  const prev = text[close - 1]
  if (prev !== undefined && /\s/.test(prev)) {
    return false
  }
  return true
}

function nextSpecial(text: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    const char = text[index]
    if (char === '`' || char === '*' || char === '~' || char === '{') {
      return index
    }
  }
  return text.length
}

function withMark(nodes: JSONContent[], mark: MarkSpec): JSONContent[] {
  return nodes.map((node) => {
    if (node.type !== 'text' || typeof node.text !== 'string') {
      return node
    }
    return {
      ...node,
      marks: [...(node.marks ?? []), mark],
    }
  })
}

function pushText(nodes: JSONContent[], text: string, marks: MarkSpec[]): void {
  if (text.length === 0) {
    return
  }
  const node: JSONContent = { type: 'text', text }
  if (marks.length > 0) {
    node.marks = marks
  }
  nodes.push(node)
}
