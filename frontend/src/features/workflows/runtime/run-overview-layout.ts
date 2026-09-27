import type { Node } from '@xyflow/react'

import { workflowContainerNodes } from '@/features/workflows/runtime/container-layout'
import type {
  GraphWorkflowNodeStatus,
  WorkflowDefinitionNode,
  WorkflowNodeData,
} from '@/features/workflows/runtime/types'

/** Overview node data: the frozen definition plus the run's per-node status overlay. */
export interface RunOverviewNodeData extends WorkflowNodeData {
  runStatus: GraphWorkflowNodeStatus
}

/** The only part of a node state the overview reads: which status to paint. */
type RunNodeStatus = GraphWorkflowNodeStatus

/**
 * Builds the read-only Overview nodes with container containment and live status data.
 *
 * Container ownership is restored the same way it is for the editor (a definition node
 * whose `data.containerId` names a known sibling becomes that sibling's child), then each
 * node carries its per-node run status—`idle` for a node the run never reached. Everything
 * is read-only: no dragging, connecting, or deletion.
 *
 * @param nodes - The frozen snapshot's definition nodes.
 * @param nodeStates - Per-node execution state keyed by node id, or `{}` for a pending run.
 * @returns React Flow nodes, containers first, parents before children.
 */
export function createRunOverviewNodes(
  nodes: readonly WorkflowDefinitionNode[],
  nodeStates: Readonly<Record<string, { status: RunNodeStatus }>> | undefined,
): Node<RunOverviewNodeData, 'workflow'>[] {
  const result: Node<RunOverviewNodeData, 'workflow'>[] = []
  for (const base of workflowContainerNodes(nodes)) {
    const node: Node<RunOverviewNodeData, 'workflow'> = {
      ...base,
      type: 'workflow',
      selectable: true,
      draggable: false,
      connectable: false,
      deletable: false,
      data: { ...base.data, runStatus: nodeStates?.[base.id]?.status ?? 'idle' },
    }
    if (base.data.containerId !== undefined) {
      node.extent = 'parent'
    }
    node.zIndex = base.data.kind === 'loop' ? 0 : 1
    result.push(node)
  }
  return result
}
