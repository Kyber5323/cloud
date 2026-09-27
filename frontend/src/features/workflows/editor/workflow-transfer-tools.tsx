import { Download, Upload } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Workflow as CloudWorkflow } from '@/api/generated.schemas'
import { Button } from '@/components/ui/button'
import { WorkflowExportDialog } from '@/features/workflows/editor/workflow-export-dialog'
import { WorkflowImportDialog } from '@/features/workflows/editor/workflow-import-dialog'

/**
 * The toolbar's import and export controls, kept together because they are one
 * story — a portable file is how a workflow moves between editors.
 *
 * Import creates a brand-new workflow from the picked file, so exporting a
 * reference graph and importing it elsewhere reproduces it instead of merging
 * into the current document. Nothing here writes to the open workflow.
 *
 * @param props.tenantId - Tenant the imported workflow belongs to.
 * @param props.workflow - Workflow whose draft or versions are exported.
 * @param props.draftGraph - Serializes the live draft when an export opens.
 * @param props.onImported - Receives the id of a workflow the import created.
 */
export function WorkflowTransferTools({
  tenantId,
  workflow,
  draftGraph,
  onImported,
}: {
  tenantId: string
  workflow: CloudWorkflow
  draftGraph: () => Record<string, unknown>
  onImported: (workflowId: string) => void
}) {
  const { t } = useTranslation()
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        title={t('workflows.transfer.importHint')}
        onClick={() => setImportOpen(true)}
      >
        <Upload className="size-3.5" />
        {t('workflows.transfer.importWorkflow')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        title={t('workflows.transfer.exportHint')}
        onClick={() => setExportOpen(true)}
      >
        <Download className="size-3.5" />
        {t('workflows.transfer.exportWorkflow')}
      </Button>
      <WorkflowImportDialog
        tenantId={tenantId}
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={onImported}
      />
      <WorkflowExportDialog
        tenantId={tenantId}
        workflow={workflow}
        draftGraph={draftGraph}
        open={exportOpen}
        onOpenChange={setExportOpen}
      />
    </div>
  )
}
