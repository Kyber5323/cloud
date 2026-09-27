import type { Edge, Node } from '@xyflow/react'
import type { WorkflowNodeData } from '@/features/workflows/runtime/types'

/**
 * One executable card on the canvas.
 *
 * The `type` parameter pins every node to the single React Flow element type
 * the canvas registers, so a node created without one cannot reach the canvas.
 */
export type WorkflowCanvasNode = Node<WorkflowNodeData, 'workflow'>

/** One directed execution edge between two cards. */
export type WorkflowCanvasEdge = Edge
