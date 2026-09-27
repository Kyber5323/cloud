import {
  WORKFLOW_NODE_INITIAL_HEIGHT,
  WORKFLOW_NODE_WIDTH,
  WORKFLOW_NODE_ANCHOR_Y,
} from '@/features/workflows/runtime/node-geometry'
import type { WorkflowNodeData, WorkflowPosition } from '@/features/workflows/runtime/types'

/** React Flow element type shared by every workflow node. */
export const WORKFLOW_FLOW_NODE_TYPE = 'workflow'

/** React Flow element type shared by every workflow edge. */
export const WORKFLOW_FLOW_EDGE_TYPE = 'workflow'

/** Grid the canvas snaps to, in flow-space pixels. */
export const WORKFLOW_SNAP_GRID: [number, number] = [20, 20]

/** Horizontal distance between two layout columns. */
const LAYOUT_COLUMN_GAP = 120

/** Vertical distance between two cards in one layout column. */
const LAYOUT_ROW_GAP = 80

/**
 * The node fields layout reads.
 *
 * Deliberately a structural subset of React Flow's `Node` so this module stays
 * free of a React Flow import: the editor passes its real nodes in, and a test
 * can pass plain objects.
 */
export interface WorkflowLayoutNode {
  id: string
  position: WorkflowPosition
  data: WorkflowNodeData
  measured?: { width?: number; height?: number }
  width?: number
  height?: number
  initialWidth?: number
  initialHeight?: number
}

/** The edge fields layout reads. */
export interface WorkflowLayoutEdge {
  source: string
  target: string
}

/** Centers a newly placed card around a flow-space point at handle height. */
export function nodePositionAt(point: WorkflowPosition): WorkflowPosition {
  return {
    x: point.x - WORKFLOW_NODE_WIDTH / 2,
    y: point.y - WORKFLOW_NODE_ANCHOR_Y,
  }
}

/** Aligns a top-left card position to the grid the canvas draws. */
export function snapNodePosition(position: WorkflowPosition): WorkflowPosition {
  return {
    x: Math.round(position.x / WORKFLOW_SNAP_GRID[0]) * WORKFLOW_SNAP_GRID[0],
    y: Math.round(position.y / WORKFLOW_SNAP_GRID[1]) * WORKFLOW_SNAP_GRID[1],
  }
}

/**
 * True when a batch of React Flow changes contains an authored edit.
 *
 * React Flow reports selection and its own size probes through the same channel
 * as user drags. Only a move, a removal or an actual resize gesture should mark
 * the draft dirty; otherwise a repaint would trigger an autosave.
 *
 * @param changes - Changes React Flow handed to `onNodesChange`.
 * @returns Whether the batch must be persisted.
 */
export function isAuthoredNodeChange(changes: readonly { type: string }[]): boolean {
  return changes.some((change) => change.type !== 'select' && change.type !== 'dimensions')
}

/**
 * Arranges a graph into left-to-right columns, one column per dependency rank.
 *
 * Columns are centered vertically against the tallest one so a wide, shallow
 * graph reads as a single row rather than drifting to the top.
 *
 * @param nodes - Nodes to arrange.
 * @param edges - Edges defining the execution order between them.
 * @returns The same nodes with positions replaced.
 */
export function organizeWorkflowNodes<T extends WorkflowLayoutNode>(
  nodes: readonly T[],
  edges: readonly WorkflowLayoutEdge[],
): T[] {
  const positions = layoutDag(nodes, edges)
  return nodes.map((node) => {
    const position = positions.get(node.id)
    return position === undefined ? node : { ...node, position }
  })
}

/** Lays out one isolated graph scope, returning a position per node id. */
function layoutDag(
  nodes: readonly WorkflowLayoutNode[],
  edges: readonly WorkflowLayoutEdge[],
): Map<string, WorkflowPosition> {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const columns = groupByRank(nodes, edges, nodeById)
  const heights = new Map<number, number>()
  for (const [rank, column] of columns) {
    heights.set(rank, columnHeight(column))
  }
  const tallest = Math.max(0, ...heights.values())

  const positions = new Map<string, WorkflowPosition>()
  let x = 0
  for (const [rank, column] of columns) {
    const ordered = column.toSorted((left, right) => compareNodes(left.id, right.id, nodeById))
    let y = (tallest - (heights.get(rank) ?? 0)) / 2
    let columnWidth = 0
    for (const node of ordered) {
      positions.set(node.id, snapNodePosition({ x, y }))
      y += nodeHeight(node) + LAYOUT_ROW_GAP
      columnWidth = Math.max(columnWidth, nodeWidth(node))
    }
    x += columnWidth + LAYOUT_COLUMN_GAP
  }
  return positions
}

/**
 * Assigns every node the longest-path rank of its dependencies.
 *
 * Nodes on a cycle keep rank 0 instead of looping forever: an unexecutable
 * graph still has to be drawn, and the cycle is reported by validation, not by
 * the layout.
 */
function groupByRank(
  nodes: readonly WorkflowLayoutNode[],
  edges: readonly WorkflowLayoutEdge[],
  nodeById: ReadonlyMap<string, WorkflowLayoutNode>,
): Map<number, WorkflowLayoutNode[]> {
  const { rank, settled } = settleRanks(nodes, buildAdjacency(nodes, edges, nodeById), nodeById)
  return bucketByRank(nodes, settled, rank)
}

/** Outgoing edges and in-degree of every node, the two tables the rank pass walks. */
interface WorkflowAdjacency {
  outgoing: Map<string, string[]>
  indegree: Map<string, number>
}

/** Builds the adjacency tables, ignoring edges whose endpoints are not in the graph. */
function buildAdjacency(
  nodes: readonly WorkflowLayoutNode[],
  edges: readonly WorkflowLayoutEdge[],
  nodeById: ReadonlyMap<string, WorkflowLayoutNode>,
): WorkflowAdjacency {
  const outgoing = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  for (const node of nodes) {
    outgoing.set(node.id, [])
    indegree.set(node.id, 0)
  }
  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      continue
    }
    outgoing.get(edge.source)?.push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }
  return { outgoing, indegree }
}

/**
 * Relaxes every node to the longest path that reaches it.
 *
 * A node only enters the queue once all its predecessors have been settled, so
 * whatever rank it holds at that moment is final. A node left in a cycle never
 * qualifies and keeps rank 0, which is what {@link bucketByRank} expects.
 *
 * @param nodes - Graph nodes.
 * @param adjacency - Outgoing edges and in-degrees.
 * @param nodeById - Nodes by id, for the ordering tie-break.
 * @returns The final rank of each node, plus the nodes that reached the queue.
 */
function settleRanks(
  nodes: readonly WorkflowLayoutNode[],
  adjacency: WorkflowAdjacency,
  nodeById: ReadonlyMap<string, WorkflowLayoutNode>,
): { rank: Map<string, number>; settled: Set<string> } {
  const { outgoing, indegree } = adjacency
  const compare = (left: string, right: string): number => compareNodes(left, right, nodeById)
  const rank = new Map(nodes.map((node) => [node.id, 0]))
  let queue = nodes
    .filter((node) => indegree.get(node.id) === 0)
    .map((node) => node.id)
    .toSorted(compare)
  const settled = new Set<string>()
  while (queue.length > 0) {
    const source = queue.shift()
    if (source === undefined) {
      break
    }
    settled.add(source)
    for (const target of (outgoing.get(source) ?? []).toSorted(compare)) {
      rank.set(target, Math.max(rank.get(target) ?? 0, (rank.get(source) ?? 0) + 1))
      const remaining = (indegree.get(target) ?? 1) - 1
      indegree.set(target, remaining)
      if (remaining === 0) {
        queue.push(target)
        queue = queue.toSorted(compare)
      }
    }
  }
  return { rank, settled }
}

/** Groups the nodes into rank columns, keeping cycles at rank 0 so they still draw. */
function bucketByRank(
  nodes: readonly WorkflowLayoutNode[],
  settled: ReadonlySet<string>,
  rank: ReadonlyMap<string, number>,
): Map<number, WorkflowLayoutNode[]> {
  const columns = new Map<number, WorkflowLayoutNode[]>()
  for (const node of nodes) {
    const column = settled.has(node.id) ? (rank.get(node.id) ?? 0) : 0
    columns.set(column, [...(columns.get(column) ?? []), node])
  }
  return new Map([...columns.entries()].toSorted(([left], [right]) => left - right))
}

/** Orders two nodes by their current vertical position, then by id for stability. */
function compareNodes(
  leftId: string,
  rightId: string,
  nodeById: ReadonlyMap<string, WorkflowLayoutNode>,
): number {
  const left = nodeById.get(leftId)
  const right = nodeById.get(rightId)
  if (left === undefined || right === undefined) {
    return leftId.localeCompare(rightId)
  }
  return left.position.y - right.position.y || leftId.localeCompare(rightId)
}

/** Total height of one column including the gaps between its cards. */
function columnHeight(column: readonly WorkflowLayoutNode[]): number {
  const cards = column.reduce((total, node) => total + nodeHeight(node), 0)
  return cards + Math.max(0, column.length - 1) * LAYOUT_ROW_GAP
}

/** Resolves a card's width, preferring what React Flow measured over the default. */
function nodeWidth(node: WorkflowLayoutNode): number {
  return node.measured?.width ?? node.width ?? node.initialWidth ?? WORKFLOW_NODE_WIDTH
}

/** Resolves a card's height, preferring what React Flow measured over the default. */
function nodeHeight(node: WorkflowLayoutNode): number {
  return node.measured?.height ?? node.height ?? node.initialHeight ?? WORKFLOW_NODE_INITIAL_HEIGHT
}
