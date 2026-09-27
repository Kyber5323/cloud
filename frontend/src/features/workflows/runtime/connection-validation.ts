import type { WorkflowLayoutEdge } from '@/features/workflows/runtime/layout'

/** The endpoint pair a candidate connection would create. */
export interface WorkflowConnectionCandidate {
  source: string | null
  target: string | null
}

/**
 * Decides whether a connection gesture may become an edge.
 *
 * Three cases are rejected because each produces a graph the runtime cannot
 * execute and the editor cannot repair:
 *
 * - a self-loop, which would make a node depend on itself;
 * - a duplicate, which would run the same node twice from one predecessor;
 * - an incomplete gesture, released on empty canvas.
 *
 * @param candidate - Endpoints React Flow is proposing.
 * @param edges - Edges already in the graph.
 * @returns Whether the edge may be added.
 */
export function isValidWorkflowConnection(
  candidate: WorkflowConnectionCandidate,
  edges: readonly WorkflowLayoutEdge[],
): boolean {
  const { source, target } = candidate
  if (source === null || target === null || source === target) {
    return false
  }
  return !edges.some((edge) => edge.source === source && edge.target === target)
}

/**
 * Builds the id of the edge between two nodes.
 *
 * Deriving it from the endpoints rather than from a counter keeps the id stable
 * across a reload, so an edge is never duplicated by re-adding the same
 * connection.
 *
 * @param source - Source node id.
 * @param target - Target node id.
 * @returns The edge id.
 */
export function workflowEdgeId(source: string, target: string): string {
  return `e-${source}-${target}`
}
