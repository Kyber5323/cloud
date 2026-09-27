import { format } from 'date-fns'
import { MoreHorizontal, Pencil, Trash2, Workflow } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { Workflow as CloudWorkflow } from '@/api/generated.schemas'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { parseWorkflowGraphValue } from '@/features/workflows/runtime/graph-codec'

/**
 * One workflow in the list: its name, what it does, and the actions a member
 * can take on it. The row is a link, so the whole target is clickable; the
 * actions menu stops propagation so opening it never navigates.
 *
 * The node count comes from the stored graph document rather than a column,
 * because the graph is opaque to the API by design — only the editor reads
 * inside it, and this count is a preview of what the editor will open.
 *
 * @param props.workflow - The workflow to render.
 * @param props.href - Destination of the row's link.
 * @param props.onRename - Opens the rename dialog for this workflow.
 * @param props.onDelete - Opens the delete confirmation for this workflow.
 */
export function WorkflowRow({
  workflow,
  href,
  onRename,
  onDelete,
}: {
  workflow: CloudWorkflow
  href: string
  onRename: (workflow: CloudWorkflow) => void
  onDelete: (workflow: CloudWorkflow) => void
}) {
  const { t } = useTranslation()
  const nodeCount = useMemo(
    () => parseWorkflowGraphValue(workflow.graph).nodes.length,
    [workflow.graph],
  )

  return (
    <div className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <Workflow className="size-4 text-muted-foreground" />
      </span>
      <Link
        to={href}
        className="min-w-0 flex-1"
        aria-label={t('workflows.list.open', { name: workflow.name })}
      >
        <p className="truncate text-sm font-medium">{workflow.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {workflow.description || t('workflows.list.nodeCount', { count: nodeCount })}
        </p>
      </Link>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
        {t('workflows.list.updatedAt', { time: format(new Date(workflow.updatedAt), 'M月d日') })}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label={t('workflows.list.open', { name: workflow.name })}
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onRename(workflow)}>
            <Pencil className="size-3.5" />
            {t('workflows.list.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(workflow)}>
            <Trash2 className="size-3.5" />
            {t('workflows.list.deleteNamed', { name: workflow.name })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
