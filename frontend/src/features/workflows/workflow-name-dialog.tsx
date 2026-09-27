import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogFormField } from '@/components/common/dialog-form-field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { workflowErrorKey } from '@/features/workflows/error-messages'

/** Which mutation the dialog is collecting input for. */
export type WorkflowNameMode = 'create' | 'rename'

/** What the dialog hands back once the member submits a valid name. */
export interface WorkflowNameSubmission {
  name: string
  description: string
}

/**
 * The dialog's form body, remounted per open so its fields start from
 * `initialName` rather than the previous submission.
 */
function WorkflowNameFields({
  mode,
  initialName,
  initialDescription,
  pending,
  errorCode,
  onSubmit,
}: {
  mode: WorkflowNameMode
  initialName: string
  initialDescription: string
  pending: boolean
  errorCode: string | undefined
  onSubmit: (submission: WorkflowNameSubmission) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const submittable = name.trim() !== '' && !pending

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!submittable) return
        onSubmit({ name: name.trim(), description: description.trim() })
      }}
      className="space-y-4"
    >
      <DialogFormField
        id="workflow-name"
        label={t('workflows.list.name')}
        value={name}
        onChange={setName}
        placeholder={t('workflows.list.namePlaceholder')}
        required
      />
      {mode === 'create' && (
        <div className="space-y-1.5">
          <label htmlFor="workflow-description" className="text-sm font-medium">
            {t('workflows.list.description')}
          </label>
          <Textarea
            id="workflow-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('workflows.list.descriptionPlaceholder')}
            rows={3}
          />
        </div>
      )}
      {errorCode !== undefined && (
        <p className="text-xs text-destructive">{t(workflowErrorKey(errorCode))}</p>
      )}
      <Button type="submit" className="w-full" disabled={!submittable}>
        {mode === 'create' ? t('workflows.list.create') : t('workflows.list.rename')}
      </Button>
    </form>
  )
}

/**
 * Collects a workflow name for creation or rename, one dialog for both because
 * the two differ only in their title, their description field, and which
 * mutation the caller wires to `onSubmit`.
 *
 * Radix unmounts the content when the dialog closes, so each open mounts the
 * fields fresh from `initialName` and a cancelled edit never carries over into
 * the next one.
 *
 * @param props.open - Whether the dialog is showing.
 * @param props.onOpenChange - Receives the next open state (false on cancel).
 * @param props.mode - Whether the submission creates or renames.
 * @param props.initialName - Name to prefill, used by rename.
 * @param props.pending - Whether the caller's mutation is in flight.
 * @param props.errorCode - Fault code from the caller's mutation, if it failed.
 * @param props.onSubmit - Receives the validated name and description.
 */
export function WorkflowNameDialog({
  open,
  onOpenChange,
  mode,
  initialName = '',
  pending,
  errorCode,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: WorkflowNameMode
  initialName?: string
  pending: boolean
  errorCode: string | undefined
  onSubmit: (submission: WorkflowNameSubmission) => void
}) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? t('workflows.list.createTitle') : t('workflows.list.rename')}
          </DialogTitle>
          {mode === 'create' && (
            <DialogDescription>{t('workflows.list.createDescription')}</DialogDescription>
          )}
        </DialogHeader>
        <WorkflowNameFields
          mode={mode}
          initialName={initialName}
          initialDescription=""
          pending={pending}
          errorCode={errorCode}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
