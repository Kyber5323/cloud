import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Variable } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WorkflowGlobalVariablesDialog } from '@/features/workflows/editor/workflow-global-variables-dialog'
import type { WorkflowGlobalVariable } from '@/features/workflows/runtime/types'

/**
 * The toolbar entry that edits workflow-wide declarations.
 *
 * The dialog is mounted only while it is open, so every visit starts from the
 * committed list: a cancelled edit disappears with the unmount, and the draft
 * is untouched until the author hits save, which is a single history step.
 *
 * @param props.variables - The declarations currently carried by the workflow.
 * @param props.onSave - Receives the committed list from the dialog.
 */
export function WorkflowVariablesTools({
  variables,
  onSave,
}: {
  variables: readonly WorkflowGlobalVariable[]
  onSave: (variables: WorkflowGlobalVariable[]) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        title={t('workflows.globalVariables.title')}
        onClick={() => setOpen(true)}
      >
        <Variable className="size-3.5" />
        {t('workflows.globalVariables.title')}
      </Button>
      {open && (
        <WorkflowGlobalVariablesDialog
          open={open}
          variables={[...variables]}
          onOpenChange={setOpen}
          onSave={onSave}
        />
      )}
    </>
  )
}
