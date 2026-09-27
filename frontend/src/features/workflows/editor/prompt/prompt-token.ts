import { Node, mergeAttributes } from '@tiptap/core'

/** What a single prompt token stands for; workflows insert variables only. */
export const PROMPT_TOKEN_KINDS = ['variable', 'command', 'role', 'skill'] as const

/** One insertable prompt token kind. */
export type PromptTokenKind = (typeof PROMPT_TOKEN_KINDS)[number]

/**
 * Whether a value names a token kind.
 *
 * `node.attrs.kind` arrives as the JSON Schema-style `any`, so narrowing through
 * a predicate keeps the extension free of an unsafe type assertion. Written as
 * explicit equality checks so the narrowing never depends on a cast.
 */
export function isPromptTokenKind(value: unknown): value is PromptTokenKind {
  return value === 'variable' || value === 'command' || value === 'role' || value === 'skill'
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    promptToken: {
      /** Inserts a variable token (and a trailing space) at the caret. */
      setPromptToken: (
        kind: PromptTokenKind,
        name: string,
        label?: string,
        /** Opaque JSON payload the React NodeView uses to enrich rendering. */
        meta?: string,
      ) => ReturnType
    }
  }
}

/** The exact text a token stands for: `{{#selector#}}` for variables. */
export function promptTokenText(kind: PromptTokenKind, name: string): string {
  if (kind === 'variable') {
    return `{{#${name}#}}`
  }
  if (kind === 'command') {
    return `/${name}`
  }
  if (kind === 'role') {
    return `@${name}`
  }
  return `$${name}`
}

/**
 * Inline variable token rendered as an atom, so it deletes as one unit and can
 * never be half-edited into a broken `{{#select#`. Round-trips through text as
 * `{{#name#}}`; the React NodeView supplies the rich Dify-style chip.
 */
export const PromptToken = Node.create({
  name: 'promptToken',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      kind: { default: 'variable' },
      name: { default: '' },
      label: { default: '' },
      meta: { default: '', rendered: false },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-prompt-token]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const kind = isPromptTokenKind(node.attrs['kind']) ? node.attrs['kind'] : 'variable'
    const name = String(node.attrs['name'])
    const label = String(node.attrs['label'])
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-prompt-token': kind,
        contenteditable: 'false',
      }),
      kind === 'variable' && label !== '' ? label : promptTokenText(kind, name),
    ]
  },

  renderText({ node }) {
    const kind = isPromptTokenKind(node.attrs['kind']) ? node.attrs['kind'] : 'variable'
    return promptTokenText(kind, String(node.attrs['name']))
  },

  addCommands() {
    return {
      setPromptToken:
        (kind, name, label = '', meta = '') =>
        ({ commands }) => {
          const chip: Record<string, unknown> = {
            type: this.name,
            attrs: { kind, name, label, meta },
          }
          return commands.insertContent([chip, { type: 'text', text: ' ' }])
        },
    }
  },
})
