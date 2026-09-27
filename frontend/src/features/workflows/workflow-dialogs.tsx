import { useTranslation } from 'react-i18next'
import type { Workflow as CloudWorkflow } from '@/api/generated.schemas'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useCreateWorkflow, useDeleteWorkflow, useRenameWorkflow } from '@/features/workflows/api'
import { workflowErrorKey } from '@/features/workflows/error-messages'
import { WorkflowNameDialog } from '@/features/workflows/workflow-name-dialog'

/**
 * The three workflow mutations a list needs, each behind its own dialog.
 *
 * They live together because they share one shape — open state, a mutation,
 * and a fault line rendered next to the controls — and because a page that
 * mounted them itself would exceed the function-length budget for what is
 * otherwise a flat composition.
 */

/**
 * Creates a workflow, then hands the new id to `onCreated` so the caller can
 * open it. The name is unique among live workflows, so a taken name reports
 * `workflow_conflict` instead of silently merging.
 *
 * @param props.tenantId - Tenant the workflow belongs to.
 * @param props.open - Whether the dialog is showing.
 * @param props.onOpenChange - Receives the next open state.
 * @param props.onCreated - Receives the id of the created workflow.
 */
export function WorkflowCreateDialog({
  tenantId,
  open,
  onOpenChange,
  onCreated,
}: {
  tenantId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (workflowId: string) => void
}) {
  const createWorkflow = useCreateWorkflow(tenantId)
  return (
    <WorkflowNameDialog
      open={open}
      onOpenChange={onOpenChange}
      mode="create"
      pending={createWorkflow.isPending}
      errorCode={createWorkflow.error?.response?.data?.code}
      onSubmit={(submission) => {
        void (async () => {
          try {
            const created = await createWorkflow.mutateAsync(submission)
            onOpenChange(false)
            onCreated(created.resource.id)
          } catch {
            // the dialog renders the fault code next to the form
          }
        })()
      }}
    />
  )
}

/**
 * Renames a workflow under its optimistic version guard. A stale version is
 * reported as "changed elsewhere" rather than overwriting the other edit.
 *
 * @param props.tenantId - Tenant the workflow belongs to.
 * @param props.workflow - Workflow to rename, or null when the dialog is closed.
 * @param props.onOpenChange - Receives the next open state.
 */
export function WorkflowRenameDialog({
  tenantId,
  workflow,
  onOpenChange,
}: {
  tenantId: string
  workflow: CloudWorkflow | null
  onOpenChange: (open: boolean) => void
}) {
  const renameWorkflow = useRenameWorkflow(tenantId)
  return (
    <WorkflowNameDialog
      open={workflow !== null}
      onOpenChange={onOpenChange}
      mode="rename"
      initialName={workflow?.name ?? ''}
      pending={renameWorkflow.isPending}
      errorCode={renameWorkflow.error?.response?.data?.code}
      onSubmit={(submission) => {
        if (!workflow) return
        void (async () => {
          try {
            await renameWorkflow.mutateAsync({
              id: workflow.id,
              name: submission.name,
              version: workflow.version,
            })
            onOpenChange(false)
          } catch {
            // the dialog renders the fault code next to the form
          }
        })()
      }}
    />
  )
}

/**
 * Confirms archiving a workflow. The backend soft-deletes the row, so the copy
 * says the name becomes reusable rather than promising erasure.
 *
 * @param props.tenantId - Tenant the workflow belongs to.
 * @param props.workflow - Workflow to archive, or null when the dialog is closed.
 * @param props.onOpenChange - Receives the next open state.
 */
export function WorkflowDeleteDialog({
  tenantId,
  workflow,
  onOpenChange,
}: {
  tenantId: string
  workflow: CloudWorkflow | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const deleteWorkflow = useDeleteWorkflow(tenantId)
  return (
    <AlertDialog open={workflow !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('workflows.list.deleteTitle', { name: workflow?.name ?? '' })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('workflows.list.deleteDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        {deleteWorkflow.error && (
          <p className="text-xs text-destructive">
            {t(workflowErrorKey(deleteWorkflow.error.response?.data?.code))}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('workflows.list.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (!workflow) return
              void (async () => {
                try {
                  await deleteWorkflow.mutateAsync({ id: workflow.id, version: workflow.version })
                  onOpenChange(false)
                } catch {
                  // the fault line above the footer already reports it
                }
              })()
            }}
          >
            {t('workflows.list.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
