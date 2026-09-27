import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Edit, GripVertical, Plus, Trash2, Variable } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { WorkflowInputVariable, WorkflowNodeData } from '@/features/workflows/runtime/types'
import { resolveWorkflowInputFieldType } from '@/features/workflows/runtime/start-input'
import { formatWorkflowVariableValue } from '@/features/workflows/runtime/variable-value'
import { StartFieldTypeIcon } from '@/features/workflows/editor/workflow-start-field-type-icon'
import {
  WorkflowStartVariableDialog,
  type StartVariableDialogState,
} from '@/features/workflows/editor/workflow-start-variable-dialog'

/** The draft a brand-new Start variable starts from. */
function newStartVariable(): WorkflowInputVariable {
  return { name: '', fieldType: 'text-input', valueType: 'string', required: false }
}

/**
 * Edits the Start node's input variables as a compact field list.
 *
 * Each row is one deployed-run form control; editing one opens the focused
 * {@link WorkflowStartVariableDialog}. Every change replaces the whole
 * `inputVariables` list through the node-data channel, so the editor records
 * the whole edit as one history step while the variables stay in the graph.
 *
 * @param props.data - The Start node's data, whose `inputVariables` are edited.
 * @param props.onChange - Receives the next node data after any edit.
 */
export function WorkflowStartVariables({
  data,
  onChange,
}: {
  data: WorkflowNodeData
  onChange: (data: WorkflowNodeData) => void
}) {
  const { t } = useTranslation()
  const variables = data.inputVariables ?? []
  const [dialog, setDialog] = useState<StartVariableDialogState | null>(null)

  function replaceVariables(next: WorkflowInputVariable[]): void {
    onChange({ ...data, inputVariables: next })
  }

  function deleteVariable(index: number): void {
    replaceVariables(variables.filter((_, candidateIndex) => candidateIndex !== index))
  }

  function saveVariable(variable: WorkflowInputVariable): void {
    if (dialog === null) {
      return
    }
    const next =
      dialog.index === null
        ? [...variables, variable]
        : variables.map((candidate, candidateIndex) =>
            candidateIndex === dialog.index ? variable : candidate,
          )
    replaceVariables(next)
    setDialog(null)
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
          {t('workflows.start.inputVariables')}
        </h4>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('workflows.start.addVariable')}
          onClick={() => setDialog({ index: null, variable: newStartVariable() })}
        >
          <Plus className="size-4" />
        </Button>
      </div>
      {variables.length === 0 ? (
        <button
          type="button"
          className="w-full rounded-lg border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground transition-colors hover:bg-muted/30"
          onClick={() => setDialog({ index: null, variable: newStartVariable() })}
        >
          {t('workflows.start.emptyVariables')}
        </button>
      ) : (
        <div className="space-y-1.5">
          {variables.map((variable, index) => (
            <StartVariableRow
              key={variable.name}
              variable={variable}
              onEdit={() => setDialog({ index, variable })}
              onDelete={() => deleteVariable(index)}
            />
          ))}
        </div>
      )}
      {dialog !== null && (
        <WorkflowStartVariableDialog
          key={`${dialog.index ?? 'new'}:${dialog.variable.name}`}
          state={dialog}
          existingNames={variables
            .filter((_, candidateIndex) => candidateIndex !== dialog.index)
            .map((variable) => variable.name)}
          onCancel={() => setDialog(null)}
          onSave={saveVariable}
        />
      )}
    </section>
  )
}

/** One declared input: its name, summary line, and the edit and remove controls. */
function StartVariableRow({
  variable,
  onEdit,
  onDelete,
}: {
  variable: WorkflowInputVariable
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const fieldType = resolveWorkflowInputFieldType(variable)
  return (
    <div className="group flex min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 shadow-sm">
      <GripVertical className="size-3.5 shrink-0 text-muted-foreground/60" />
      <Variable className="size-4 shrink-0 text-blue-600" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-1">
          <code className="truncate text-xs font-semibold text-foreground">{variable.name}</code>
          {variable.displayName !== undefined && variable.displayName !== '' && (
            <span className="truncate text-[11px] text-muted-foreground">
              · {variable.displayName}
            </span>
          )}
        </div>
        <p className="truncate text-[10px] text-muted-foreground">
          {t(`workflows.start.fieldTypes.${fieldType}`)}
          {variable.maxLength !== undefined &&
            ` · ${t('workflows.start.maxLengthSummary', { count: variable.maxLength })}`}
          {' · '}
          {variable.value === undefined
            ? t('workflows.start.configureAfterDeploy')
            : formatWorkflowVariableValue(variable.value, variable.valueType)}
        </p>
      </div>
      <StartFieldTypeIcon
        fieldType={fieldType}
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground"
        aria-label={t('workflows.start.editVariable', { name: variable.name })}
        onClick={onEdit}
      >
        <Edit className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        aria-label={t('workflows.start.deleteVariable', { name: variable.name })}
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}
