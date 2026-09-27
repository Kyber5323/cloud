import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { WorkflowDraftSaveStatus } from '@/features/workflows/editor/use-workflow-draft-autosave'

const STATUS_KEYS = {
  clean: 'workflows.save.clean',
  dirty: 'workflows.save.dirty',
  saving: 'workflows.save.saving',
  error: 'workflows.save.error',
} as const

/**
 * Surfaces autosave progress in the editor header.
 *
 * There is no manual save control: the draft is written on a debounce, and this
 * label is the only signal of whether the canvas on screen matches the server.
 * It is a live region so a failed write is announced rather than only coloured.
 *
 * @param props - The current autosave status.
 */
export function WorkflowDraftSaveStatusLabel({ status }: { status: WorkflowDraftSaveStatus }) {
  const { t } = useTranslation()
  const label = t(STATUS_KEYS[status])
  return (
    <p
      aria-live="polite"
      title={label}
      className={cn(
        'max-w-56 shrink-0 truncate text-right text-[10px] leading-4 text-muted-foreground',
        status === 'error' && 'text-destructive',
      )}
    >
      {label}
    </p>
  )
}
