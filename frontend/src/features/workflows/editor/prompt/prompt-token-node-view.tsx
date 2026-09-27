import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { isJsonRecord } from '@/features/workflows/runtime/json-record'
import { isWorkflowNodeKind } from '@/features/workflows/runtime/types'
import {
  WorkflowVariableDisplay,
  type WorkflowDisplayVariable,
} from '@/features/workflows/editor/workflow-variable-select'
import { isPromptTokenKind, promptTokenText } from '@/features/workflows/editor/prompt/prompt-token'

/** JSON payload stored on a variable token so its NodeView renders Dify-style. */
interface VariableTokenMeta {
  kind?: WorkflowDisplayVariable['sourceNodeKind']
  node: string
  variableName: string
}

/**
 * Unwraps the opaque meta string the insertion path stored on the token.
 *
 * The string came from this editor, but a graph can carry a meta from another
 * author or a corrupt import, so every field is guarded instead of cast.
 */
function parseVariableTokenMeta(raw: string): VariableTokenMeta | null {
  if (raw === '') {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (!isJsonRecord(parsed)) {
    return null
  }
  const node = parsed['node']
  const variableName = parsed['variableName']
  if (typeof node !== 'string' || typeof variableName !== 'string') {
    return null
  }
  const kind = parsed['kind']
  return {
    node,
    variableName,
    ...(isWorkflowNodeKind(kind) ? { kind } : {}),
  }
}

/**
 * Renders a prompt token: a rich variable chip when the meta says how to
 * display it, or the raw `{{#name#}}` text so an unknown token stays legible.
 */
export function PromptTokenNodeView({ node }: NodeViewProps) {
  const kind = isPromptTokenKind(node.attrs['kind']) ? node.attrs['kind'] : 'variable'
  const name = String(node.attrs['name'])
  const label = String(node.attrs['label'])

  if (kind !== 'variable') {
    return (
      <NodeViewWrapper
        as="span"
        data-prompt-token={kind}
        contentEditable={false}
        className="mx-0.5 rounded-[4px] bg-muted px-1 py-0.5 font-medium text-foreground"
      >
        {label !== '' ? label : promptTokenText(kind, name)}
      </NodeViewWrapper>
    )
  }

  const meta = parseVariableTokenMeta(String(node.attrs['meta'] ?? ''))
  if (meta === null) {
    return (
      <NodeViewWrapper
        as="span"
        data-prompt-token="variable"
        contentEditable={false}
        className="mx-0.5 rounded-[4px] bg-muted px-1 py-0.5 font-medium text-foreground"
      >
        {label !== '' ? label : promptTokenText('variable', name)}
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper
      as="span"
      data-prompt-token="variable"
      data-workflow-prompt-variable=""
      contentEditable={false}
      className="mx-0.5 inline-flex max-w-full rounded-[4px] bg-muted px-1 py-0.5 align-middle"
    >
      <WorkflowVariableDisplay
        variable={{
          variableName: meta.variableName,
          ...(meta.kind === undefined ? {} : { sourceNodeKind: meta.kind }),
        }}
        nodeName={meta.node}
      />
    </NodeViewWrapper>
  )
}
