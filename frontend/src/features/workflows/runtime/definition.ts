import type {
  WorkflowDefinition,
  WorkflowDefinitionEdge,
  WorkflowDefinitionNode,
  WorkflowGlobalVariable,
  WorkflowNodeData,
  WorkflowPosition,
  WorkflowViewport,
} from '@/features/workflows/runtime/types'
import { workflowContainerNodes } from '@/features/workflows/runtime/container-layout'

/** Stable validation failure that adapters can map to their transport error model. */
export class WorkflowDefinitionValidationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid workflow definition: ${issues.join('; ')}`)
    this.name = 'WorkflowDefinitionValidationError'
    this.issues = issues
  }
}

export interface WorkflowDefinitionInputNode {
  id: string
  type?: string
  position: WorkflowPosition
  data: WorkflowNodeData
  parentId?: string
  deletable?: boolean
  initialWidth?: number
  initialHeight?: number
  width?: number
  height?: number
}

export interface WorkflowDefinitionInputEdge {
  id: string
  source: string
  target: string
  type?: string
  label?: unknown
  data?: Record<string, unknown>
  sourceHandle?: string | null
  targetHandle?: string | null
}

/** Editor-facing shape accepted at the deploy boundary before normalization. */
export interface WorkflowDefinitionInput {
  id: string
  name: string
  description: string
  updatedAt: string
  viewport: WorkflowViewport
  globalVariables?: readonly WorkflowGlobalVariable[]
  nodes: readonly WorkflowDefinitionInputNode[]
  edges: readonly WorkflowDefinitionInputEdge[]
}

/** Migrates deprecated Start instruction data while preserving all other node configuration. */
function normalizeWorkflowNodeData(data: WorkflowNodeData): WorkflowNodeData {
  const cloned = structuredClone(data)
  if (cloned.kind === 'start' && cloned.input === undefined && cloned.instruction !== undefined) {
    const { instruction, ...startData } = cloned
    return { ...startData, input: instruction }
  }
  return cloned
}

/** Copies one editor node into its persisted shape, dropping React Flow runtime fields. */
function normalizeWorkflowNode(node: WorkflowDefinitionInputNode): WorkflowDefinitionNode {
  const normalized: WorkflowDefinitionNode = {
    id: node.id,
    type: 'workflow',
    position: { ...node.position },
    data: normalizeWorkflowNodeData(node.data),
  }
  if (node.parentId !== undefined) {
    normalized.parentId = node.parentId
  }
  if (node.deletable !== undefined) {
    normalized.deletable = node.deletable
  }
  const initialWidth = node.width ?? node.initialWidth
  const initialHeight = node.height ?? node.initialHeight
  if (initialWidth !== undefined) {
    normalized.initialWidth = initialWidth
  }
  if (initialHeight !== undefined) {
    normalized.initialHeight = initialHeight
  }
  return normalized
}

/** Copies one editor edge into its persisted shape, keeping display text as plain data. */
function normalizeWorkflowEdge(edge: WorkflowDefinitionInputEdge): WorkflowDefinitionEdge {
  const normalized: WorkflowDefinitionEdge = {
    id: edge.id,
    source: edge.source,
    target: edge.target,
  }
  if (edge.type === 'workflow') {
    normalized.type = 'workflow'
  }
  if (typeof edge.label === 'string') {
    normalized.label = edge.label
  }
  if (edge.data !== undefined) {
    normalized.data = structuredClone(edge.data)
  }
  if (typeof edge.sourceHandle === 'string') {
    normalized.sourceHandle = edge.sourceHandle
  }
  if (typeof edge.targetHandle === 'string') {
    normalized.targetHandle = edge.targetHandle
  }
  return normalized
}

/** Removes React Flow runtime fields while preserving unfinished authoring topology. */
export function normalizeWorkflowDocument(input: WorkflowDefinitionInput): WorkflowDefinition {
  const definition: WorkflowDefinition = {
    id: input.id,
    name: input.name,
    description: input.description,
    updatedAt: input.updatedAt,
    viewport: { ...input.viewport },
    ...(input.globalVariables === undefined
      ? {}
      : { globalVariables: structuredClone([...input.globalVariables]) }),
    nodes: workflowContainerNodes(input.nodes).map(normalizeWorkflowNode),
    edges: input.edges.map(normalizeWorkflowEdge),
  }
  validateWorkflowDocument(definition)
  return definition
}

/** Document-level identity rules: a named definition holding at least one node. */
function collectDocumentIssues(definition: WorkflowDefinition): string[] {
  const issues: string[] = []
  if (definition.id.trim() === '') {
    issues.push('definition id must not be empty')
  }
  if (definition.nodes.length === 0) {
    issues.push('at least one node is required')
  }
  return issues
}

/** Node rules: every node is identified once and carries a finite position. */
function collectNodeIssues(nodes: readonly WorkflowDefinitionNode[]): string[] {
  const issues: string[] = []
  const seen = new Set<string>()
  for (const node of nodes) {
    if (node.id.trim() === '') {
      issues.push('node id must not be empty')
    } else if (seen.has(node.id)) {
      issues.push(`duplicate node id ${node.id}`)
    }
    seen.add(node.id)
    if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) {
      issues.push(`node ${node.id || '<empty>'} has a non-finite position`)
    }
  }
  return issues
}

/** Edge rules: every edge is identified once and joins two known nodes. */
function collectEdgeIssues(
  edges: readonly WorkflowDefinitionEdge[],
  nodeIds: ReadonlySet<string>,
): string[] {
  const issues: string[] = []
  const seen = new Set<string>()
  for (const edge of edges) {
    if (edge.id.trim() === '') {
      issues.push('edge id must not be empty')
    } else if (seen.has(edge.id)) {
      issues.push(`duplicate edge id ${edge.id}`)
    }
    seen.add(edge.id)
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push(`edge ${edge.id || '<empty>'} references an unknown node`)
    }
  }
  return issues
}

/** Viewport rules: finite coordinates and a positive zoom. */
function collectViewportIssues(viewport: WorkflowViewport): string[] {
  const finite =
    Number.isFinite(viewport.x) && Number.isFinite(viewport.y) && Number.isFinite(viewport.zoom)
  if (finite && viewport.zoom > 0) {
    return []
  }
  return ['viewport must contain finite coordinates and a positive zoom']
}

/** Checks document identity and geometry without imposing runtime reachability or DAG rules. */
function validateWorkflowDocument(definition: WorkflowDefinition): void {
  const nodeIds = new Set(definition.nodes.map((node) => node.id))
  const issues = [
    ...collectDocumentIssues(definition),
    ...collectNodeIssues(definition.nodes),
    ...collectEdgeIssues(definition.edges, nodeIds),
    ...collectViewportIssues(definition.viewport),
  ]
  if (issues.length > 0) {
    throw new WorkflowDefinitionValidationError(issues)
  }
}

/**
 * Peels a topological order off the graph. Array iteration is live, so nodes appended to
 * `queue` while it is being walked are visited too; a result shorter than the node list
 * therefore means the graph contains a cycle.
 */
function topologicalOrder(definition: WorkflowDefinition): string[] {
  const adjacency = new Map(definition.nodes.map((node) => [node.id, [] as string[]]))
  const indegree = new Map(definition.nodes.map((node) => [node.id, 0]))
  for (const edge of definition.edges) {
    adjacency.get(edge.source)?.push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }
  const queue = definition.nodes
    .filter((node) => indegree.get(node.id) === 0)
    .map((node) => node.id)
  for (const current of queue) {
    for (const target of adjacency.get(current) ?? []) {
      const degree = (indegree.get(target) ?? 0) - 1
      indegree.set(target, degree)
      if (degree === 0) {
        queue.push(target)
      }
    }
  }
  return queue
}

/** Preserves the stricter executable contract used by the in-memory runtime. */
export function normalizeWorkflowDefinition(input: WorkflowDefinitionInput): WorkflowDefinition {
  const definition = normalizeWorkflowDocument(input)
  validateWorkflowDefinition(definition)
  return definition
}

/** Execution adapters validate DAGs separately from authoring document persistence. */
export function validateWorkflowDefinition(definition: WorkflowDefinition): void {
  validateWorkflowDocument(definition)
  if (topologicalOrder(definition).length !== definition.nodes.length) {
    throw new WorkflowDefinitionValidationError(['graph must be acyclic'])
  }
}
