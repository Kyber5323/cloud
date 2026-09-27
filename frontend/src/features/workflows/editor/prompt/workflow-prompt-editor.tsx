import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import type { JSONContent } from '@tiptap/core'
import { Node as PmNode } from '@tiptap/pm/model'
import { Copy, Maximize2, Variable } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { WorkflowDecoratedVariable } from '@/features/workflows/runtime/variable-catalog'
import { groupWorkflowVariables } from '@/features/workflows/runtime/variable-groups'
import { isWorkflowNodeKind } from '@/features/workflows/runtime/types'
import { WorkflowVariableRowContent } from '@/features/workflows/editor/workflow-variable-select'
import { WorkflowPromptVariableToken } from '@/features/workflows/editor/prompt/workflow-prompt-token-extension'
import { promptDocumentPlainText } from '@/features/workflows/editor/prompt/prompt-plain-text'
import { promptMarkdownToContent } from '@/features/workflows/editor/prompt/prompt-markdown'
import {
  INLINE_SLASH_TRIGGER_PATTERN,
  promptSlashQueryFromText,
} from '@/features/workflows/editor/prompt/prompt-query'

/** Where the variable menu sits; defaults below the toolbar. */
interface PromptMenuPosition {
  left: number
  top: number
}

/** Fallback placement when the caret cannot be measured. */
const DEFAULT_PROMPT_MENU_POSITION: PromptMenuPosition = { left: 8, top: 68 }

/** The text range to restore when an external control took focus. */
interface PromptSelection {
  from: number
  to: number
}

/** Props shared by the editor surface and its callers. */
export interface WorkflowPromptEditorProps {
  value: string
  catalog: readonly WorkflowDecoratedVariable[]
  ariaLabel: string
  insertVariableLabel: string
  onChange: (value: string) => void
}

/**
 * Edits an Agent prompt with caret-anchored variable insertion and compact
 * text tools. The stored `prompt` string stays the source of truth: every edit
 * commits the serialized plain text, and reopening (or a history undo) seeds
 * fresh from that string, so the editor never holds state the graph does not.
 */
export function WorkflowPromptEditor({
  value,
  catalog,
  ariaLabel,
  insertVariableLabel,
  onChange,
}: WorkflowPromptEditorProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const globalVariablesLabel = t('workflows.variable.global')
  const initialDocument = useMemo(
    () => promptDocumentFor(value, catalog, globalVariablesLabel),
    [globalVariablesLabel, value, catalog],
  )

  const surface = (): ReactNode => (
    <PromptEditorSurface
      initialDocument={initialDocument}
      value={value}
      catalog={catalog}
      globalVariablesLabel={globalVariablesLabel}
      ariaLabel={ariaLabel}
      insertVariableLabel={insertVariableLabel}
      expanded={expanded}
      onExpand={() => setExpanded(true)}
      onCommit={onChange}
    />
  )

  return (
    <>
      {!expanded && surface()}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{ariaLabel}</DialogTitle>
          </DialogHeader>
          {expanded && surface()}
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * One live Tiptap editor plus its toolbar and slash menu.
 *
 * The surface remounts when the dialog expands (seeding from the committed
 * value), which is why it never holds a draft of its own — the prop value is the
 * only thing that survives the move.
 */
interface PromptEditorSurfaceProps {
  initialDocument: JSONContent
  value: string
  catalog: readonly WorkflowDecoratedVariable[]
  globalVariablesLabel: string
  ariaLabel: string
  insertVariableLabel: string
  expanded: boolean
  onExpand: () => void
  onCommit: (text: string) => void
}

function PromptEditorSurface({
  initialDocument,
  value,
  catalog,
  globalVariablesLabel,
  ariaLabel,
  insertVariableLabel,
  expanded,
  onExpand,
  onCommit,
}: PromptEditorSurfaceProps) {
  const { t } = useTranslation()
  const [characterCount, setCharacterCount] = useState(value.length)
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState<PromptMenuPosition>(DEFAULT_PROMPT_MENU_POSITION)
  const panelRef = useRef<HTMLDivElement>(null)
  const preservedSelectionRef = useRef<PromptSelection | null>(null)
  const lastQueryRef = useRef<string | null>(null)
  const emittedTextRef = useRef(value)

  const editor = useEditor({
    extensions: [StarterKit, WorkflowPromptVariableToken],
    content: initialDocument,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        id: 'workflow-agent-prompt',
        role: 'textbox',
        'aria-multiline': 'true',
        class: cn(
          'px-3 py-1.5 focus:outline-none [&_p]:my-1',
          expanded ? 'h-full max-h-[50vh]' : 'min-h-32 max-h-64 overflow-y-auto',
        ),
      },
    },
    onUpdate: ({ editor: current }) => {
      const text = promptDocumentPlainText(current.state.doc)
      emittedTextRef.current = text
      setCharacterCount(text.length)
      current.view.dom.dataset['composerText'] = text
      onCommit(text)
      schedulePromptMenu(current, { lastQueryRef, setSlashQuery, panelRef, setMenuPosition })
    },
    onSelectionUpdate: ({ editor: current }) =>
      schedulePromptMenu(current, { lastQueryRef, setSlashQuery, panelRef, setMenuPosition }),
  })

  return (
    <div
      ref={panelRef}
      className={cn(
        'relative rounded-lg border border-input bg-background',
        expanded && 'min-h-[55vh]',
      )}
    >
      <PromptEditorEffects
        editor={editor}
        value={value}
        ariaLabel={ariaLabel}
        slashQuery={slashQuery}
        emittedTextRef={emittedTextRef}
      />
      <PromptToolbar
        characterCount={characterCount}
        characterCountLabel={t('workflows.inspector.field.promptCharacterCount', {
          count: characterCount,
        })}
        canInsert={catalog.length > 0}
        insertVariableLabel={insertVariableLabel}
        copyLabel={t('workflows.inspector.field.copyPrompt')}
        expandLabel={t('workflows.inspector.field.expandPrompt')}
        onPreserveSelection={() => preserveSelectionAt(editor, preservedSelectionRef)}
        onInsertVariable={() => insertSlashAtSelection(editor, preservedSelectionRef.current)}
        onCopy={() => copyPromptText(editor, value, emittedTextRef)}
        onExpand={onExpand}
      />
      <EditorContent
        editor={editor}
        className={cn('text-xs leading-5', expanded ? 'min-h-0' : 'min-h-32')}
      />
      {slashQuery !== null && editor !== null && (
        <PromptSlashMenu
          insertVariableLabel={insertVariableLabel}
          menuPosition={menuPosition}
          catalog={catalog}
          query={slashQuery}
          globalVariablesLabel={globalVariablesLabel}
          onInsert={(variable) => {
            insertPromptVariable(editor, variable, globalVariablesLabel)
            setSlashQuery(null)
            lastQueryRef.current = null
          }}
        />
      )}
    </div>
  )
}

/**
 * The viewer of the result of a caret-anchored slash query.
 *
 * Renders as an absolutely positioned listbox, mirroring the desktop composer.
 */
function PromptSlashMenu({
  insertVariableLabel,
  menuPosition,
  catalog,
  query,
  globalVariablesLabel,
  onInsert,
}: {
  insertVariableLabel: string
  menuPosition: PromptMenuPosition
  catalog: readonly WorkflowDecoratedVariable[]
  query: string
  globalVariablesLabel: string
  onInsert: (variable: WorkflowDecoratedVariable) => void
}) {
  return (
    <div
      role="listbox"
      aria-label={insertVariableLabel}
      className="absolute z-50 max-h-56 w-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      style={{ left: menuPosition.left, top: menuPosition.top }}
    >
      <PromptVariableMenu
        catalog={catalog}
        query={query}
        globalVariablesLabel={globalVariablesLabel}
        emptyLabel={insertVariableLabel}
        onInsert={onInsert}
      />
    </div>
  )
}

/**
 * Side effects that need the live editor but not render: reseed from an
 * external `value` change and keep the ARIA menu state current.
 *
 * The reseed skips our own commit echo — a history undo that rewrites the
 * stored prompt string must not fight the caret — then reapplies only when the
 * serialized document truly differs, so re-renders stay no-ops.
 */
function PromptEditorEffects({
  editor,
  value,
  ariaLabel,
  slashQuery,
  emittedTextRef,
}: {
  editor: Editor | null
  value: string
  ariaLabel: string
  slashQuery: string | null
  emittedTextRef: { current: string }
}) {
  useEffect(() => {
    if (editor === null || value === emittedTextRef.current) {
      return
    }
    const parsed = PmNode.fromJSON(editor.schema, promptMarkdownToContent(value))
    if (!editor.state.doc.eq(parsed)) {
      editor.commands.setContent(parsed.toJSON())
    }
  }, [editor, value, emittedTextRef])

  useEffect(() => {
    if (editor === null) {
      return
    }
    const dom = editor.view.dom
    dom.setAttribute('aria-label', ariaLabel)
    dom.setAttribute('aria-autocomplete', 'list')
    dom.setAttribute('aria-haspopup', 'listbox')
    dom.setAttribute('aria-expanded', slashQuery !== null ? 'true' : 'false')
  }, [editor, ariaLabel, slashQuery])

  return null
}

/**
 * The compact tool row: live character count plus variable / copy / expand.
 *
 * The variable button types a `/` at the preserved caret instead of inserting
 * a token directly, so the author can still fine-tune the query before picking.
 */
function PromptToolbar({
  characterCount,
  characterCountLabel,
  canInsert,
  insertVariableLabel,
  copyLabel,
  expandLabel,
  onPreserveSelection,
  onInsertVariable,
  onCopy,
  onExpand,
}: {
  characterCount: number
  characterCountLabel: string
  canInsert: boolean
  insertVariableLabel: string
  copyLabel: string
  expandLabel: string
  onPreserveSelection: () => void
  onInsertVariable: () => void
  onCopy: () => void
  onExpand: () => void
}) {
  return (
    <div className="flex h-9 items-center justify-end gap-0.5 border-b border-border bg-muted/35 px-1.5">
      <span
        className="mr-auto px-1.5 text-[11px] tabular-nums text-muted-foreground"
        aria-label={characterCountLabel}
      >
        {characterCount}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7"
        disabled={!canInsert}
        aria-label={insertVariableLabel}
        title={insertVariableLabel}
        onMouseDown={(event) => {
          onPreserveSelection()
          // Keeping browser focus in the editor preserves the visible caret
          // while the button still receives its click.
          event.preventDefault()
        }}
        onClick={onInsertVariable}
      >
        <Variable className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7"
        aria-label={copyLabel}
        title={copyLabel}
        onClick={onCopy}
      >
        <Copy className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7"
        aria-label={expandLabel}
        title={expandLabel}
        onClick={onExpand}
      >
        <Maximize2 className="size-4" />
      </Button>
    </div>
  )
}

/**
 * The grouped variable list fed by the current slash query.
 *
 * Uses the same rows as every other selector, but rendered as plain buttons
 * because a caret-anchored listbox is not a `<select>`.
 */
function PromptVariableMenu({
  catalog,
  query,
  globalVariablesLabel,
  emptyLabel,
  onInsert,
}: {
  catalog: readonly WorkflowDecoratedVariable[]
  query: string
  globalVariablesLabel: string
  emptyLabel: string
  onInsert: (variable: WorkflowDecoratedVariable) => void
}) {
  const visibleVariables = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (needle === '') {
      return catalog
    }
    return catalog.filter((variable) => {
      const selector = variable.selector.join('.').toLocaleLowerCase()
      return selector.includes(needle) || variable.variableName.toLocaleLowerCase().includes(needle)
    })
  }, [catalog, query])
  const groups = useMemo(
    () => groupWorkflowVariables(visibleVariables, globalVariablesLabel),
    [globalVariablesLabel, visibleVariables],
  )
  if (visibleVariables.length === 0) {
    return <p className="px-2 py-3 text-center text-xs text-muted-foreground">{emptyLabel}</p>
  }
  return (
    <>
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <p className="px-2 pt-1.5 pb-0.5 text-[11px] font-medium text-muted-foreground">
            {group.label}
          </p>
          {group.variables.map((variable) => {
            const selector = variable.selector.join('.')
            return (
              <button
                key={selector}
                type="button"
                role="option"
                aria-label={selector}
                aria-selected="false"
                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onInsert(variable)}
              >
                <WorkflowVariableRowContent variable={variable} />
              </button>
            )
          })}
        </section>
      ))}
    </>
  )
}

/** The slash query the caret currently sits in, or null outside a code block. */
function activePromptQuery(editor: Editor): string | null {
  const before = editor.state.doc.textBetween(0, editor.state.selection.from, '\n', '\n')
  const inCodeBlock = editor.state.selection.$from.parent.type.name === 'codeBlock'
  return inCodeBlock ? null : promptSlashQueryFromText(before)
}

/**
 * Recomputes the active slash query from the caret, closing the menu when one
 * ends and scheduling a reposition below the caret when one starts.
 */
function schedulePromptMenu(
  editor: Editor,
  controls: {
    lastQueryRef: { current: string | null }
    setSlashQuery: (value: string | null) => void
    panelRef: { current: HTMLDivElement | null }
    setMenuPosition: (position: PromptMenuPosition) => void
  },
): void {
  const next = activePromptQuery(editor)
  if (next === controls.lastQueryRef.current) {
    return
  }
  controls.lastQueryRef.current = next
  controls.setSlashQuery(next)
  if (next !== null) {
    requestAnimationFrame(() =>
      positionPromptMenu(editor, controls.panelRef, controls.setMenuPosition),
    )
  }
}

/** Places the variable menu immediately below the editor's active slash caret. */
function positionPromptMenu(
  editor: Editor,
  panelRef: { current: HTMLDivElement | null },
  setMenuPosition: (position: PromptMenuPosition) => void,
): void {
  const panel = panelRef.current?.getBoundingClientRect()
  let caret: DOMRect | null = null
  try {
    const coordinates = editor.view.coordsAtPos(editor.state.selection.head)
    caret = new DOMRect(
      coordinates.left,
      coordinates.top,
      coordinates.right - coordinates.left,
      coordinates.bottom - coordinates.top,
    )
  } catch {
    caret = null
  }
  if (panel === undefined || panel.width <= 0 || caret === null) {
    setMenuPosition(DEFAULT_PROMPT_MENU_POSITION)
    return
  }
  setMenuPosition({
    left: Math.max(8, Math.min(caret.left - panel.left, panel.width - 272)),
    top: caret.bottom - panel.top + 4,
  })
}

/** Parks the current selection so the variable button can restore it later. */
function preserveSelectionAt(
  editor: Editor | null,
  preservedSelectionRef: { current: PromptSelection | null },
): void {
  preservedSelectionRef.current =
    editor === null
      ? null
      : {
          from: editor.state.selection.from,
          to: editor.state.selection.to,
        }
}

/** Replaces the active slash query with one serialized variable token. */
function insertPromptVariable(
  editor: Editor,
  variable: WorkflowDecoratedVariable,
  globalVariablesLabel: string,
): void {
  deleteTriggerToken(editor)
  const name = variable.selector.join('.')
  editor
    .chain()
    .focus()
    .setPromptToken('variable', name, name, variableTokenMeta(variable, globalVariablesLabel))
    .run()
}

/** Types a `/` at a preserved selection, or the live caret when none was parked. */
function insertSlashAtSelection(editor: Editor | null, selection: PromptSelection | null): void {
  if (editor === null) {
    return
  }
  const chain = editor.chain().focus()
  if (selection === null) {
    chain.insertContent('/').run()
  } else {
    chain.insertContentAt(selection, '/', { updateSelection: true }).run()
  }
}

/** Writes the current prompt text to the system clipboard. */
function copyPromptText(
  editor: Editor | null,
  fallback: string,
  emittedTextRef: { current: string },
): void {
  const text =
    editor === null ? fallback : emittedTextRef.current || promptDocumentPlainText(editor.state.doc)
  void navigator.clipboard?.writeText(text)
}

/**
 * Seeds a document from the stored string, enriching every variable token with
 * the label and render meta the current catalog knows about.
 */
function promptDocumentFor(
  value: string,
  catalog: readonly WorkflowDecoratedVariable[],
  globalVariablesLabel: string,
): JSONContent {
  const variablesBySelector = new Map(
    catalog.map((variable) => [
      variable.selector.join('.'),
      {
        label: variable.selector.join('.'),
        meta: variableTokenMeta(variable, globalVariablesLabel),
      },
    ]),
  )
  const enrich = (node: JSONContent): JSONContent => {
    const content = node.content?.map(enrich)
    if (node.type !== 'promptToken' || node.attrs?.['kind'] !== 'variable') {
      return content === undefined ? node : { ...node, content }
    }
    const name = String(node.attrs['name'] ?? '')
    const found = variablesBySelector.get(name)
    return {
      ...node,
      attrs: {
        ...node.attrs,
        label: found?.label ?? name,
        meta: found?.meta ?? '',
      },
      ...(content === undefined ? {} : { content }),
    }
  }
  return enrich(promptMarkdownToContent(value))
}

/** Serializes the presentation-only data the token NodeView needs. */
function variableTokenMeta(
  variable: WorkflowDecoratedVariable,
  globalVariablesLabel: string,
): string {
  return JSON.stringify({
    ...(isWorkflowNodeKind(variable.sourceNodeKind) ? { kind: variable.sourceNodeKind } : {}),
    node:
      variable.sourceNodeTitle ??
      (variable.scope === 'global' ? globalVariablesLabel : variable.sourceNodeId),
    variableName: variable.variableName,
  })
}

/** Removes the active `/query` immediately before the caret. */
function deleteTriggerToken(editor: Editor): void {
  const { $from } = editor.state.selection
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\n')
  const match = textBefore.match(INLINE_SLASH_TRIGGER_PATTERN)
  if (match?.index === undefined) {
    return
  }
  editor
    .chain()
    .focus()
    .deleteRange({ from: $from.start() + match.index, to: $from.pos })
    .run()
}
