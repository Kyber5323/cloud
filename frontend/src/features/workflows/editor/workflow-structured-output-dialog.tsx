import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Braces, Check, ListTree, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { WORKFLOW_VARIABLE_VALUE_TYPES } from '@/features/workflows/runtime/types'
import { validateWorkflowStructuredOutputSchema } from '@/features/workflows/runtime/structured-output-schema'
import { isWorkflowVariableValueType } from '@/features/workflows/runtime/variable-value'
import {
  addStructuredOutputField,
  createStructuredOutputSchemaDraft,
  emptyStructuredOutputSchemaDraft,
  parseWorkflowStructuredOutputSchema,
  removeStructuredOutputField,
  replaceStructuredOutputField,
  setStructuredOutputFieldType,
  structuredOutputDraftChildren,
  structuredOutputDraftToSchema,
  structuredOutputFieldSupportsChildren,
  type StructuredOutputFieldDraft,
  type StructuredOutputSchemaDraft,
  type StructuredOutputSchemaObject,
} from '@/features/workflows/editor/structured-output-schema-editor'

/** How the author is editing the schema: field rows or raw JSON. */
type EditorMode = 'visual' | 'json'

/**
 * Edits an Agent node's structured output schema without touching the node
 * until 保存. Two modes — the visual tree and a raw JSON editor — share a
 * single draft, and a structured-only root keeps both renderings valid.
 */
export function WorkflowStructuredOutputDialog({
  open,
  schema,
  onOpenChange,
  onSave,
}: {
  open: boolean
  schema: StructuredOutputSchemaObject
  onOpenChange: (open: boolean) => void
  onSave: (schema: StructuredOutputSchemaObject) => void
}) {
  if (!open) {
    return null
  }
  return (
    <WorkflowStructuredOutputDialogContent
      schema={schema}
      onOpenChange={onOpenChange}
      onSave={onSave}
    />
  )
}

/**
 * Owns the fresh draft each opening seeds, so cancel can discard every edit
 * and the next opening starts from the persisted schema again.
 */
function WorkflowStructuredOutputDialogContent({
  schema,
  onOpenChange,
  onSave,
}: {
  schema: StructuredOutputSchemaObject
  onOpenChange: (open: boolean) => void
  onSave: (schema: StructuredOutputSchemaObject) => void
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<EditorMode>('visual')
  const [draft, setDraft] = useState<StructuredOutputSchemaDraft>(() =>
    createStructuredOutputSchemaDraft(schema),
  )
  const [json, setJson] = useState(() => JSON.stringify(schema, null, 2))
  const [error, setError] = useState('')

  function selectMode(nextMode: EditorMode): void {
    if (nextMode === mode) {
      return
    }
    if (mode === 'json') {
      const parsed = parseWorkflowStructuredOutputSchema(json)
      if (parsed === null || !validateWorkflowStructuredOutputSchema(parsed).valid) {
        setError(t('workflows.structuredOutput.invalidSchema'))
        return
      }
      setDraft(createStructuredOutputSchemaDraft(parsed))
    } else {
      setJson(JSON.stringify(structuredOutputDraftToSchema(draft), null, 2))
    }
    setError('')
    setMode(nextMode)
  }

  function save(): void {
    const next =
      mode === 'json'
        ? parseWorkflowStructuredOutputSchema(json)
        : structuredOutputDraftToSchema(draft)
    if (next === null || !validateWorkflowStructuredOutputSchema(next).valid) {
      setError(t('workflows.structuredOutput.invalidSchema'))
      return
    }
    onSave(next)
    onOpenChange(false)
  }

  function clear(): void {
    const next = emptyStructuredOutputSchemaDraft()
    setDraft(next)
    setJson(JSON.stringify(structuredOutputDraftToSchema(next), null, 2))
    setError('')
  }

  function handleJsonChange(text: string): void {
    setJson(text)
    setError('')
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(760px,calc(100vh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle>{t('workflows.structuredOutput.schemaTitle')}</DialogTitle>
        </DialogHeader>
        <StructuredOutputModeTabs mode={mode} onSelect={selectMode} />
        <div className="min-h-0 flex-1 px-6 pb-4">
          {mode === 'visual' ? (
            <StructuredOutputVisualPanel draft={draft} onChange={setDraft} error={error} />
          ) : (
            <StructuredOutputJsonPanel json={json} onChange={handleJsonChange} error={error} />
          )}
        </div>
        <DialogFooter className="mx-0 mb-0 shrink-0 bg-background px-6 py-4">
          <Button variant="outline" onClick={clear}>
            {t('workflows.structuredOutput.clear')}
          </Button>
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('workflows.list.cancel')}
          </Button>
          <Button onClick={save}>{t('workflows.globalVariables.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The visual / JSON toggle, kept a sibling so the dialog's header stays flat. */
function StructuredOutputModeTabs({
  mode,
  onSelect,
}: {
  mode: EditorMode
  onSelect: (mode: EditorMode) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center px-6 py-2">
      <div
        className="inline-flex rounded-lg bg-muted p-0.5"
        role="tablist"
        aria-label={t('workflows.structuredOutput.editorMode')}
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'visual'}
          className="flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-muted-foreground aria-selected:bg-background aria-selected:text-blue-600 aria-selected:shadow-sm"
          onClick={() => onSelect('visual')}
        >
          <ListTree className="size-4" />
          {t('workflows.structuredOutput.modeVisual')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'json'}
          className="flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-muted-foreground aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-sm"
          onClick={() => onSelect('json')}
        >
          <Braces className="size-4" />
          {t('workflows.structuredOutput.modeJson')}
        </button>
      </div>
    </div>
  )
}

/** Scrollable room around the field tree, sharing the mode error line. */
function StructuredOutputVisualPanel({
  draft,
  onChange,
  error,
}: {
  draft: StructuredOutputSchemaDraft
  onChange: (draft: StructuredOutputSchemaDraft) => void
  error: string
}) {
  return (
    <>
      <div className="h-full overflow-auto rounded-xl bg-muted/60 p-3">
        <StructuredOutputObjectEditor
          draft={draft}
          containerId={draft.rootId}
          depth={0}
          onChange={onChange}
        />
      </div>
      {error !== '' && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  )
}

/** The raw JSON editor, mirroring whatever the field tree would commit. */
function StructuredOutputJsonPanel({
  json,
  onChange,
  error,
}: {
  json: string
  onChange: (json: string) => void
  error: string
}) {
  const { t } = useTranslation()
  return (
    <>
      <Textarea
        aria-label={t('workflows.structuredOutput.jsonLabel')}
        className="h-full min-h-0 resize-none rounded-xl bg-muted/40 font-mono text-xs leading-5"
        value={json}
        onChange={(event) => onChange(event.target.value)}
      />
      {error !== '' && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  )
}

/**
 * The object rows of one container.
 *
 * Every container — the root and each nested object / array-item object — gets
 * its own 添加字段 action, so a nested branch can grow on its own instead of
 * relying on row-level child buttons.
 */
function StructuredOutputObjectEditor({
  draft,
  containerId,
  depth,
  onChange,
}: {
  draft: StructuredOutputSchemaDraft
  containerId: number
  depth: number
  onChange: (draft: StructuredOutputSchemaDraft) => void
}) {
  const { t } = useTranslation()
  const fields = structuredOutputDraftChildren(draft, containerId)
  const addField = (): void => onChange(addStructuredOutputField(draft, containerId))
  return (
    <div className={depth === 0 ? 'space-y-2' : 'mt-2 space-y-2 border-l border-border pl-3'}>
      {depth === 0 && (
        <div className="flex items-center justify-between gap-3 px-1 py-0.5">
          <div className="flex items-center gap-2">
            <code className="text-xs font-semibold">structured_output</code>
            <span className="text-[11px] text-muted-foreground">object</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={addField}
          >
            <Plus className="size-3.5" />
            {t('workflows.structuredOutput.addField')}
          </Button>
        </div>
      )}
      {fields.map((field) => (
        <StructuredOutputFieldRow key={field.id} field={field} draft={draft} onChange={onChange} />
      ))}
      {depth > 0 && (
        <Button type="button" variant="ghost" size="sm" className="w-full" onClick={addField}>
          <Plus className="size-3.5" />
          {t('workflows.structuredOutput.addField')}
        </Button>
      )}
    </div>
  )
}

/**
 * One schema property and the nested rows its object value holds.
 *
 * The row collapses to a compact name + type display and expands to its name,
 * type and description inputs; the controls on the right stay available in both
 * states, so required, nested fields and deletion never need an extra click.
 */
function StructuredOutputFieldRow({
  field,
  draft,
  onChange,
}: {
  field: StructuredOutputFieldDraft
  draft: StructuredOutputSchemaDraft
  onChange: (draft: StructuredOutputSchemaDraft) => void
}) {
  const [editing, setEditing] = useState(false)
  const update = (next: StructuredOutputFieldDraft): void =>
    onChange(replaceStructuredOutputField(draft, field.id, next))
  const changeType = (value: string | null): void => {
    if (isWorkflowVariableValueType(value)) {
      update(setStructuredOutputFieldType(field, value))
    }
  }
  return (
    <div className="relative">
      <div
        className={
          editing
            ? 'rounded-lg border border-border bg-background p-2 shadow-sm'
            : 'rounded-lg px-2 py-1.5 hover:bg-background/80'
        }
      >
        <div className="flex min-w-0 items-start gap-2">
          <StructuredOutputFieldIdentity
            field={field}
            editing={editing}
            onRename={(name) => update({ ...field, name })}
            onChangeType={changeType}
            onChangeDescription={(description) => update({ ...field, description })}
          />
          <StructuredOutputFieldControls
            fieldName={field.name}
            required={field.required}
            editing={editing}
            onToggleRequired={(required) => update({ ...field, required })}
            onToggleEditing={() => setEditing((current) => !current)}
            onDelete={() => onChange(removeStructuredOutputField(draft, field.id))}
          />
        </div>
      </div>
      {structuredOutputFieldSupportsChildren(field.valueType) && (
        <StructuredOutputObjectEditor
          draft={draft}
          containerId={field.id}
          depth={1}
          onChange={onChange}
        />
      )}
    </div>
  )
}

/**
 * The field's editable half: name and type while editing, a compact name, type
 * and required badge when collapsed, with the description beneath in both.
 */
function StructuredOutputFieldIdentity({
  field,
  editing,
  onRename,
  onChangeType,
  onChangeDescription,
}: {
  field: StructuredOutputFieldDraft
  editing: boolean
  onRename: (name: string) => void
  onChangeType: (value: string | null) => void
  onChangeDescription: (description: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="min-w-0 flex-1">
      {editing ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Input
            aria-label={t('workflows.structuredOutput.fieldName')}
            className="h-8 min-w-40 flex-1 text-xs"
            value={field.name}
            onChange={(event) => onRename(event.target.value)}
          />
          <Select value={field.valueType} onValueChange={onChangeType}>
            <SelectTrigger
              aria-label={t('workflows.structuredOutput.fieldType')}
              className="h-8 w-40 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORKFLOW_VARIABLE_VALUE_TYPES.map((valueType) => (
                <SelectItem key={valueType} value={valueType}>
                  {valueType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <code className="truncate text-xs font-semibold">{field.name}</code>
          <span className="text-[11px] text-muted-foreground">{field.valueType}</span>
          {field.required && (
            <span className="text-[10px] font-medium text-orange-600">
              {t('workflows.structuredOutput.required')}
            </span>
          )}
        </div>
      )}
      {editing ? (
        <Input
          aria-label={t('workflows.structuredOutput.fieldDescription')}
          className="mt-2 h-8 text-xs"
          value={field.description}
          placeholder={t('workflows.structuredOutput.descriptionPlaceholder')}
          onChange={(event) => onChangeDescription(event.target.value)}
        />
      ) : (
        field.description !== '' && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{field.description}</p>
        )
      )}
    </div>
  )
}

/** The per-row button cluster: required, edit toggle, and delete. */
function StructuredOutputFieldControls({
  fieldName,
  required,
  editing,
  onToggleRequired,
  onToggleEditing,
  onDelete,
}: {
  fieldName: string
  required: boolean
  editing: boolean
  onToggleRequired: (required: boolean) => void
  onToggleEditing: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <label className="mr-1 flex items-center gap-1 text-[10px] text-muted-foreground">
        {t('workflows.structuredOutput.required')}
        <Switch size="sm" checked={required} onCheckedChange={onToggleRequired} />
      </label>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t('workflows.structuredOutput.editField', { name: fieldName })}
        onClick={onToggleEditing}
      >
        {editing ? <Check className="size-3.5" /> : <Pencil className="size-3.5" />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        aria-label={t('workflows.structuredOutput.deleteField', { name: fieldName })}
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}
