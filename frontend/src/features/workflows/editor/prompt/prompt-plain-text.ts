import type { Mark, Node as PmNode } from '@tiptap/pm/model'
import {
  promptTokenText,
  type PromptTokenKind,
} from '@/features/workflows/editor/prompt/prompt-token'

/**
 * CommonMark inline code: the fence is one backtick longer than the longest
 * run inside the payload, with space padding so an inner `` ` `` cannot close
 * the span. A single backtick stays the everyday `` `code` `` form.
 */
function wrapInlineCode(text: string): string {
  const longestRun = text.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0
  const fence = '`'.repeat(Math.max(1, longestRun + 1))
  if (
    longestRun > 0 ||
    text.startsWith(' ') ||
    text.endsWith(' ') ||
    text.startsWith('`') ||
    text.endsWith('`')
  ) {
    return `${fence} ${text} ${fence}`
  }
  return `${fence}${text}${fence}`
}

/**
 * One marked run as Markdown source. Code wins over every other mark (the
 * payload is literal), then the strike / italic / bold wrap order matches the
 * parser's delimiter table exactly, so `***x***` round-trips as bold+italic.
 */
function wrapInlineMarkdown(text: string, marks: readonly Mark[]): string {
  let out = text
  const names = new Set(marks.map((mark) => mark.type.name))
  if (names.has('code')) {
    return wrapInlineCode(out)
  }
  if (names.has('strike')) {
    out = `~~${out}~~`
  }
  if (names.has('italic')) {
    out = `*${out}*`
  }
  if (names.has('bold')) {
    out = `**${out}**`
  }
  return out
}

/** One marked text run as Markdown source, for tests and delimiters. */
export function promptInlineMarksPlainText(text: string, marks: readonly Mark[]): string {
  return wrapInlineMarkdown(text, marks)
}

function serializeText(node: PmNode): string {
  return wrapInlineMarkdown(node.text ?? '', node.marks)
}

/** A prompt leaf without children: variable tokens and hard breaks. */
function leafPlainText(node: PmNode): string {
  switch (node.type.name) {
    case 'hardBreak':
      return '\n'
    case 'promptToken': {
      const raw = node.attrs['kind']
      const kind: PromptTokenKind =
        raw === 'variable' || raw === 'command' || raw === 'role' || raw === 'skill'
          ? raw
          : 'variable'
      return promptTokenText(kind, String(node.attrs['name']))
    }
    case 'horizontalRule':
      return '---'
    default:
      return ''
  }
}

function serializeInline(node: PmNode): string {
  let out = ''
  node.forEach((child) => {
    if (child.isText) {
      out += serializeText(child)
      return
    }
    if (child.isLeaf) {
      out += leafPlainText(child)
      return
    }
    out += serializeInline(child)
  })
  return out
}

function joinChildBlocks(node: PmNode, indent: string): string {
  const parts: string[] = []
  node.forEach((child) => {
    parts.push(serializeBlock(child, indent))
  })
  return parts.join('\n')
}

function serializeListItem(node: PmNode, indent: string, marker: string): string {
  const parts: string[] = []
  let first = true
  node.forEach((child) => {
    if (first && child.type.name === 'paragraph') {
      parts.push(`${indent}${marker}${serializeInline(child)}`)
      first = false
      return
    }
    first = false
    parts.push(serializeBlock(child, `${indent}  `))
  })
  return parts.join('\n')
}

function serializeList(node: PmNode, indent: string, markerFor: (index: number) => string): string {
  const parts: string[] = []
  let index = 0
  node.forEach((child) => {
    parts.push(serializeListItem(child, indent, markerFor(index)))
    index += 1
  })
  return parts.join('\n')
}

function serializeBlock(node: PmNode, indent = ''): string {
  switch (node.type.name) {
    case 'horizontalRule':
      return `${indent}---`
    case 'heading':
      return serializeHeading(node, indent)
    case 'codeBlock':
      return serializeCodeBlock(node, indent)
    case 'blockquote':
      return serializeBlockquote(node, indent)
    case 'bulletList':
      return serializeList(node, indent, () => '- ')
    case 'orderedList': {
      const start = Number(node.attrs['start'] ?? 1)
      return serializeList(node, indent, (index) => `${start + index}. `)
    }
    case 'listItem':
      return serializeListItem(node, indent, '- ')
    case 'paragraph':
      return `${indent}${serializeInline(node)}`
    default:
      if (node.isLeaf) {
        return `${indent}${leafPlainText(node)}`
      }
      return joinChildBlocks(node, indent)
  }
}

function serializeHeading(node: PmNode, indent: string): string {
  const level = Math.min(Math.max(Number(node.attrs['level'] ?? 1), 1), 6)
  const inline = serializeInline(node)
  return inline.length === 0
    ? `${indent}${'#'.repeat(level)}`
    : `${indent}${'#'.repeat(level)} ${inline}`
}

function serializeCodeBlock(node: PmNode, indent: string): string {
  const raw = node.attrs['language']
  const language = raw === null || raw === undefined || raw === '' ? '' : String(raw)
  const text = node.textContent
  // Longer than any backtick run in the body so a nested ``` line cannot
  // close the fence on parse (CommonMark closing-fence rule).
  const longestRun = text.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return `${indent}${fence}${language}\n${text}\n${indent}${fence}`
}

function serializeBlockquote(node: PmNode, indent: string): string {
  const inner = joinChildBlocks(node, '')
  return inner
    .split('\n')
    .map((line) => (line.length === 0 ? `${indent}>` : `${indent}> ${line}`))
    .join('\n')
}

/**
 * Reads a prompt document as textarea-like plain text: hard breaks and block
 * boundaries both become a single newline, so the stored `prompt` string stays
 * the source of truth. Structured blocks keep Markdown prefixes so the author
 * sees headings, lists, fences and marks.
 */
export function promptDocumentPlainText(doc: PmNode): string {
  const parts: string[] = []
  doc.forEach((node) => {
    parts.push(serializeBlock(node))
  })
  return parts.join('\n')
}
