import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import {
  WORKFLOW_LAUNCH_FIELD_DEFAULTS,
  type WorkflowLaunchField,
  type WorkflowLaunchFieldKey,
} from '@/features/workflows/runtime/types'

/** One row of the dialog: a catalogue field and the two answers the author gives about it. */
interface LaunchFieldRow {
  key: WorkflowLaunchFieldKey
  enabled: boolean
  required: boolean
}

/**
 * Declares which launch fields the `@` form asks for, and which of them it insists on.
 *
 * The rows are the platform's whole catalogue and nothing else — five of them, never more and never
 * fewer — so the dialog edits answers rather than a list, and there is no add or remove button. A row
 * the Start node already declares a variable for is shown but not editable: that variable owns the
 * key, so a declaration about it would do nothing, and letting the author set one would be a lie.
 *
 * The dialog works on its own copy, so cancelling discards the edits and nothing reaches the draft
 * until save. Saving writes all five keys with both answers spelled out: the projection reads an
 * unstated answer as the platform's default, so naming every one keeps the stored declaration
 * self-describing without changing what it means.
 *
 * @param props.open - Whether the dialog is showing.
 * @param props.fields - The declaration currently carried by the workflow.
 * @param props.startVariableNames - Names the Start node declares; those rows are inert.
 * @param props.hasSnapshots - Whether the workflow has a published version, or `undefined` while that
 * is still unknown. The version field needs one to have anything to offer.
 * @param props.onOpenChange - Receives the next open state.
 * @param props.onSave - Receives the committed declaration; the editor records it.
 */
export function WorkflowLaunchFieldsDialog({
  open,
  fields,
  startVariableNames,
  hasSnapshots,
  onOpenChange,
  onSave,
}: {
  open: boolean
  fields: WorkflowLaunchField[]
  startVariableNames: readonly string[]
  hasSnapshots: boolean | undefined
  onOpenChange: (open: boolean) => void
  onSave: (fields: WorkflowLaunchField[]) => void
}) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<LaunchFieldRow[]>(() => seedRows(fields))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('workflows.launchFields.title')}</DialogTitle>
          <DialogDescription>{t('workflows.launchFields.description')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {rows.map((row) => (
            <LaunchFieldRowItem
              key={row.key}
              row={row}
              declaredByStart={startVariableNames.includes(row.key)}
              versionUnavailable={row.key === 'version' && hasSnapshots === false}
              onToggleEnabled={(enabled) => patchRow(row.key, { enabled })}
              onToggleRequired={(required) => patchRow(row.key, { required })}
            />
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('workflows.list.cancel')}
          </Button>
          <Button onClick={commit}>{t('workflows.globalVariables.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  function patchRow(key: WorkflowLaunchFieldKey, patch: Partial<LaunchFieldRow>): void {
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) {
          return row
        }
        const next = { ...row, ...patch }
        // A field the form does not ask for cannot be required, so that answer is dropped rather
        // than kept as a hidden one: the declaration never says two things at once.
        return next.enabled ? next : { ...next, required: false }
      }),
    )
  }

  function commit(): void {
    onSave(rows.map((row) => ({ key: row.key, enabled: row.enabled, required: row.required })))
    onOpenChange(false)
  }
}

/**
 * One catalogue field with its two switches.
 *
 * A field the author does not ask for cannot be required, so that switch is disabled rather than left
 * to mean something — the projection would ignore it anyway, and a control that appears to work but
 * does not is worse than one that says it cannot.
 */
function LaunchFieldRowItem({
  row,
  declaredByStart,
  versionUnavailable,
  onToggleEnabled,
  onToggleRequired,
}: {
  row: LaunchFieldRow
  declaredByStart: boolean
  versionUnavailable: boolean
  onToggleEnabled: (enabled: boolean) => void
  onToggleRequired: (required: boolean) => void
}) {
  const { t } = useTranslation()
  const label = t(`workflows.launchFields.${row.key}`)

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{label}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(`workflows.launchFields.${row.key}Hint`)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {t('workflows.launchFields.ask')}
            <Switch
              size="sm"
              checked={row.enabled}
              disabled={declaredByStart}
              onCheckedChange={onToggleEnabled}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {t('workflows.launchFields.required')}
            <Switch
              size="sm"
              checked={row.required}
              disabled={declaredByStart || !row.enabled}
              onCheckedChange={onToggleRequired}
            />
          </label>
        </div>
      </div>
      {declaredByStart && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t('workflows.launchFields.declaredByStart')}
        </p>
      )}
      {versionUnavailable && row.enabled && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t('workflows.launchFields.noVersion')}
        </p>
      )}
    </div>
  )
}

/**
 * Builds the rows from the committed declaration.
 *
 * The catalogue is the source of the row list, not the declaration: a workflow that has never been
 * edited here carries nothing, and it still opens on all five fields at the platform's own answers,
 * which is exactly the form it has today.
 */
function seedRows(fields: readonly WorkflowLaunchField[]): LaunchFieldRow[] {
  const declared = new Map(fields.map((field) => [field.key, field] as const))
  return WORKFLOW_LAUNCH_FIELD_DEFAULTS.map((entry) => {
    const field = declared.get(entry.key)
    return {
      key: entry.key,
      enabled: field?.enabled ?? true,
      required: field?.required ?? entry.required,
    }
  })
}
