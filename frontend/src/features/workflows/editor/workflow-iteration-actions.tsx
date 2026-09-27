import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { workflowNodeMetadata } from '@/features/workflows/editor/node-metadata'
import { useWorkflowTranslator } from '@/features/workflows/editor/use-workflow-translator'
import {
  workflowNodeTypeDefinition,
  workflowPaletteNodeTypes,
  type WorkflowNodeTypeDefinition,
} from '@/features/workflows/runtime/node-catalog'
import type { WorkflowIterationInsertion } from '@/features/workflows/runtime/iteration-graph'
import type { WorkflowNodeKind } from '@/features/workflows/runtime/types'

/**
 * Graph-aware iteration authoring actions exposed to composite chrome.
 *
 * The frame and its insert seams read this context instead of accepting one
 * callback each, because the same menu renders at several seams and every seam
 * needs the same gate: which node kinds the region accepts and whether the
 * canvas is read-only.
 */
export interface WorkflowIterationActions {
  /** Palette entries the region accepts, in menu order. */
  nodeTypes: readonly WorkflowNodeTypeDefinition[]
  readOnly: boolean
  /** Adds a member of `kind` through an explicit region insertion seam. */
  insert: (kind: WorkflowNodeKind, insertion: WorkflowIterationInsertion) => void
  /** Folds or unfolds one iteration frame; members stay in the graph. */
  toggleCollapsed: (iterationId: string) => void
}

const WorkflowIterationActionsContext = createContext<WorkflowIterationActions | null>(null)

/** Reads iteration graph actions; only valid below the canvas provider. */
export function useWorkflowIterationActions(): WorkflowIterationActions {
  const value = useContext(WorkflowIterationActionsContext)
  if (value === null) {
    throw new Error('useWorkflowIterationActions requires WorkflowIterationActionsProvider')
  }
  return value
}

/** Provides graph-aware iteration authoring actions to custom nodes. */
export function WorkflowIterationActionsProvider({
  readOnly,
  onInsert,
  onToggleCollapsed,
  children,
}: {
  readOnly: boolean
  onInsert: (kind: WorkflowNodeKind, insertion: WorkflowIterationInsertion) => void
  onToggleCollapsed: (iterationId: string) => void
  children: ReactNode
}) {
  const value = useMemo<WorkflowIterationActions>(
    () => ({
      nodeTypes: workflowPaletteNodeTypes('iteration'),
      readOnly,
      insert: onInsert,
      toggleCollapsed: onToggleCollapsed,
    }),
    [onInsert, onToggleCollapsed, readOnly],
  )
  return (
    <WorkflowIterationActionsContext.Provider value={value}>
      {children}
    </WorkflowIterationActionsContext.Provider>
  )
}

/** Props shared by every insert-seam trigger. */
interface IterationInsertMenuProps {
  /** The graph seam the picker inserts at. */
  insertion: WorkflowIterationInsertion
  /** Accessible label of the trigger, naming the seam. */
  label: string
  /** Controlled menu state for seams whose port doubles as the trigger. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Extra classes for the blue affordance button. */
  className?: string
}

/**
 * The capability-filtered node picker for one region insertion seam.
 *
 * The trigger mirrors the entry affordance: a solid blue circle with a white
 * plus. Seams keep the circle decorative (`pointer-events-none`) and open the
 * menu from the underlying port's click instead, so a connection drag from the
 * handle is never intercepted.
 */
export function IterationInsertMenu({
  insertion,
  label,
  open,
  onOpenChange,
  className,
}: IterationInsertMenuProps) {
  const translate = useWorkflowTranslator()
  const { nodeTypes, readOnly, insert } = useWorkflowIterationActions()
  if (readOnly || nodeTypes.length === 0) {
    return null
  }
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="default"
            size="icon-xs"
            aria-label={label}
            className={cn(
              'nodrag nopan rounded-full bg-blue-600 text-white shadow-sm hover:bg-blue-700',
              className,
            )}
          />
        }
      >
        <Plus className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-44">
        {nodeTypes.map((nodeType) => {
          const Icon = workflowNodeMetadata(nodeType.kind).icon
          return (
            <DropdownMenuItem
              key={nodeType.kind}
              className="gap-2 text-xs"
              onClick={() => insert(nodeType.kind, { ...insertion })}
            >
              <Icon className="size-3.5" />
              {translate(workflowNodeTypeDefinition(nodeType.kind).labelKey)}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
