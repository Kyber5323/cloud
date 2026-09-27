import { Rocket } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Workflow as CloudWorkflow } from '@/api/generated.schemas'
import { Button } from '@/components/ui/button'
import { WorkflowPublishDialog } from '@/features/workflows/editor/workflow-publish-dialog'
import { WorkflowVersionHistory } from '@/features/workflows/editor/workflow-version-history'

/**
 * The toolbar's publish and history controls, kept together because they are
 * one story — a version is a freeze of the draft, and history is where a member
 * goes to roll back to one.
 *
 * Publishing first flushes the draft so the frozen version is never stale: a
 * save that could not persist (a version conflict, a dropped connection) blocks
 * the publish dialog instead of freezing the previous content.
 *
 * @param props.tenantId - Tenant the workflow belongs to.
 * @param props.workflowId - Workflow being edited.
 * @param props.committedVersion - Latest document version the server confirmed;
 * it guards a restore.
 * @param props.flushDraft - Writes the draft to completion before publishing.
 * @param props.onRestored - Receives the workflow once a rollback replaced the
 * graph.
 */
export function WorkflowVersionTools({
  tenantId,
  workflowId,
  committedVersion,
  flushDraft,
  onRestored,
}: {
  tenantId: string
  workflowId: string
  committedVersion: number
  flushDraft: () => Promise<boolean>
  onRestored: (workflow: CloudWorkflow) => void
}) {
  const { t } = useTranslation()
  const [publishOpen, setPublishOpen] = useState(false)

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        title={t('workflows.version.publishHint')}
        onClick={() => void openPublish()}
      >
        <Rocket className="size-3.5" />
        {t('workflows.version.publish')}
      </Button>
      <WorkflowVersionHistory
        tenantId={tenantId}
        workflowId={workflowId}
        committedVersion={committedVersion}
        onRestored={onRestored}
      />
      <WorkflowPublishDialog
        tenantId={tenantId}
        workflowId={workflowId}
        open={publishOpen}
        onOpenChange={setPublishOpen}
      />
    </div>
  )

  /** Persists the draft, then lets a member turn it into a frozen version. */
  async function openPublish(): Promise<void> {
    const saved = await flushDraft()
    if (!saved) {
      return
    }
    setPublishOpen(true)
  }
}
