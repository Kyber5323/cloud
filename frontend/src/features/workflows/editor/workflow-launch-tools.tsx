import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AtSign } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkflowSnapshots } from '@/features/workflows/api'
import { WorkflowLaunchFieldsDialog } from '@/features/workflows/editor/workflow-launch-fields-dialog'
import type { WorkflowLaunchField } from '@/features/workflows/runtime/types'

/**
 * The toolbar entry that declares which launch fields the `@` form asks for.
 *
 * The dialog is mounted only while it is open, so every visit starts from the
 * committed declaration: a cancelled edit disappears with the unmount, and the
 * draft is untouched until the author saves, which is a single history step.
 *
 * @param props.tenantId - Tenant the workflow belongs to.
 * @param props.workflowId - Workflow being edited.
 * @param props.fields - The declaration currently carried by the workflow.
 * @param props.startVariableNames - Names the Start node declares; those rows are inert.
 * @param props.onSave - Receives the committed declaration from the dialog.
 */
export function WorkflowLaunchTools({
  tenantId,
  workflowId,
  fields,
  startVariableNames,
  onSave,
}: {
  tenantId: string
  workflowId: string
  fields: readonly WorkflowLaunchField[]
  startVariableNames: readonly string[]
  onSave: (fields: WorkflowLaunchField[]) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // A published version is what the version field offers, so the dialog says when there is none
  // rather than leaving the author to wonder why that switch changes nothing. The answer stays
  // `undefined` until the query resolves: a pending read must not claim there are no versions.
  const snapshots = useWorkflowSnapshots(tenantId, workflowId)
  const hasSnapshots = snapshots.data === undefined ? undefined : snapshots.data.length > 0

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        title={t('workflows.launchFields.title')}
        onClick={() => setOpen(true)}
      >
        <AtSign className="size-3.5" />
        {t('workflows.launchFields.title')}
      </Button>
      {open && (
        <WorkflowLaunchFieldsDialog
          open={open}
          fields={[...fields]}
          startVariableNames={startVariableNames}
          hasSnapshots={hasSnapshots}
          onOpenChange={setOpen}
          onSave={onSave}
        />
      )}
    </>
  )
}
