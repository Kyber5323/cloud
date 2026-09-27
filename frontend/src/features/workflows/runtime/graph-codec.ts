import type {
  WorkflowDefinitionEdge,
  WorkflowDefinitionNode,
  WorkflowGlobalVariable,
  WorkflowViewport,
} from '@/features/workflows/runtime/types'
import { workflowContainerNodes } from '@/features/workflows/runtime/container-layout'
import { asJsonRecord } from '@/features/workflows/runtime/json-record'

/** The persisted graph envelope: editor geometry plus optional metadata. */
export interface WorkflowGraphEnvelope {
  schemaVersion?: number
  nodes: WorkflowDefinitionNode[]
  edges: WorkflowDefinitionEdge[]
  viewport: WorkflowViewport
  annotations: WorkflowGraphAnnotation[]
  globalVariables: WorkflowGlobalVariable[]
  description?: string
}

/** Serializable editor note kept outside the executable node list. */
export interface WorkflowGraphAnnotation {
  id: string
  type: 'annotation'
  position: { x: number; y: number }
  width?: number
  height?: number
  selected?: boolean
  data: {
    text: string
    theme: 'yellow' | 'blue' | 'green' | 'pink' | 'gray'
  }
}

const DEFAULT_VIEWPORT: WorkflowViewport = { x: 0, y: 0, zoom: 1 }

const WORKFLOW_ANNOTATION_THEMES = new Set(['yellow', 'blue', 'green', 'pink', 'gray'])

/** True for a number the editor can safely use as a coordinate. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** The envelope a missing or unreadable graph collapses to. */
function emptyWorkflowGraph(): WorkflowGraphEnvelope {
  return {
    nodes: [],
    edges: [],
    viewport: DEFAULT_VIEWPORT,
    annotations: [],
    globalVariables: [],
  }
}

/** The editor graph an envelope is built from. */
export interface WorkflowGraphInput {
  nodes: readonly WorkflowDefinitionNode[]
  edges: readonly WorkflowDefinitionEdge[]
  viewport: WorkflowViewport
  annotations?: readonly WorkflowGraphAnnotation[]
  globalVariables?: readonly WorkflowGlobalVariable[]
  description?: string
}

/**
 * Builds the graph envelope as a plain object.
 *
 * The envelope carries serializable geometry, annotations, and the description; the workflow
 * name and timestamps stay on the Workflow record. Unknown fields ride through parsing unchanged.
 *
 * This is the form the cloud API stores: `workflows.graph` is a jsonb object, so the envelope is
 * handed to the request body as-is. {@link serializeWorkflowGraph} wraps it for the text column
 * the desktop snapshot store uses.
 */
export function serializeWorkflowGraphValue(input: WorkflowGraphInput): Record<string, unknown> {
  const usesLoopContainers = input.nodes.some(
    (node) => node.data.kind === 'loop' || node.data.containerId !== undefined,
  )
  return {
    ...(usesLoopContainers ? { schemaVersion: 2 } : {}),
    nodes: input.nodes,
    edges: input.edges,
    viewport: input.viewport,
    annotations: input.annotations ?? [],
    globalVariables: input.globalVariables ?? [],
    ...(input.description === undefined ? {} : { description: input.description }),
  }
}

/**
 * Serializes the editor graph into the JSON text a snapshot's graph column holds.
 *
 * @param input - Editor graph to encode.
 * @returns The envelope as a JSON string.
 */
export function serializeWorkflowGraph(input: WorkflowGraphInput): string {
  return JSON.stringify(serializeWorkflowGraphValue(input))
}

/**
 * Narrows one persisted node. Checks only what this codec and the container layout depend on —
 * a non-empty id, finite geometry, and object `data` — and leaves the rest of the node contract
 * to `validateWorkflowDocument`. A kind this version does not recognise is kept rather than
 * dropped, so a graph written by a newer editor still loads.
 */
function isWorkflowDefinitionNode(value: unknown): value is WorkflowDefinitionNode {
  const node = asJsonRecord(value)
  if (node === undefined) {
    return false
  }
  const position = asJsonRecord(node['position'])
  return (
    typeof node['id'] === 'string' &&
    node['id'].trim() !== '' &&
    position !== undefined &&
    isFiniteNumber(position['x']) &&
    isFiniteNumber(position['y']) &&
    asJsonRecord(node['data']) !== undefined
  )
}

/** Narrows one persisted edge: a non-empty id joining two named nodes. */
function isWorkflowDefinitionEdge(value: unknown): value is WorkflowDefinitionEdge {
  const edge = asJsonRecord(value)
  return (
    edge !== undefined &&
    typeof edge['id'] === 'string' &&
    edge['id'].trim() !== '' &&
    typeof edge['source'] === 'string' &&
    typeof edge['target'] === 'string'
  )
}

/** Guards workflow-wide variables before exposing persisted data to the editor. */
export function isWorkflowGlobalVariable(value: unknown): value is WorkflowGlobalVariable {
  const variable = asJsonRecord(value)
  return (
    variable !== undefined &&
    typeof variable['name'] === 'string' &&
    variable['name'].includes('.') &&
    typeof variable['valueType'] === 'string'
  )
}

/** Guards editor-note data before custom nodes render persisted content. */
export function isWorkflowGraphAnnotation(value: unknown): value is WorkflowGraphAnnotation {
  const annotation = asJsonRecord(value)
  if (annotation === undefined) {
    return false
  }
  const position = asJsonRecord(annotation['position'])
  const data = asJsonRecord(annotation['data'])
  return (
    typeof annotation['id'] === 'string' &&
    annotation['id'].trim() !== '' &&
    annotation['type'] === 'annotation' &&
    position !== undefined &&
    isFiniteNumber(position['x']) &&
    isFiniteNumber(position['y']) &&
    data !== undefined &&
    typeof data['text'] === 'string' &&
    typeof data['theme'] === 'string' &&
    WORKFLOW_ANNOTATION_THEMES.has(data['theme'])
  )
}

/** Guards the persisted viewport shape before the editor trusts its coordinates. */
function isWorkflowViewport(value: unknown): value is WorkflowViewport {
  const viewport = asJsonRecord(value)
  return (
    viewport !== undefined &&
    isFiniteNumber(viewport['x']) &&
    isFiniteNumber(viewport['y']) &&
    isFiniteNumber(viewport['zoom'])
  )
}

/**
 * Re-maps legacy node kinds that predate the base-node model, and pins the React Flow node type
 * the editor renders with. The former "prompt" node was renamed to "model" and then folded into
 * the Agent node, which already carries model configuration, so persisted graphs keep loading
 * unchanged as Agent steps.
 */
function normalizePersistedNode(node: WorkflowDefinitionNode): WorkflowDefinitionNode {
  const kind: unknown = node.data.kind
  const data =
    kind === 'prompt' || kind === 'model' ? { ...node.data, kind: 'agent' as const } : node.data
  return node.type === 'workflow' && data === node.data
    ? node
    : { ...node, type: 'workflow' as const, data }
}

/**
 * Parses a snapshot graph string back into the editor envelope.
 *
 * @param graph - The envelope as JSON text, or any unreadable value.
 * @returns The parsed envelope, or the empty graph when the text is not JSON.
 */
export function parseWorkflowGraph(graph: string): WorkflowGraphEnvelope {
  let value: unknown
  try {
    value = JSON.parse(graph)
  } catch {
    return emptyWorkflowGraph()
  }
  return parseWorkflowGraphValue(value)
}

/**
 * Parses a graph envelope that is already a decoded value — the shape the cloud API returns for
 * `workflows.graph`, which is jsonb rather than text.
 *
 * Tolerates malformed or partial envelopes: a non-object or missing arrays collapse to empty,
 * a missing viewport falls back to the origin, and unknown fields survive the round-trip.
 *
 * @param value - Decoded graph document.
 * @returns The parsed envelope, or the empty graph when `value` is not an object.
 */
export function parseWorkflowGraphValue(value: unknown): WorkflowGraphEnvelope {
  const record = asJsonRecord(value)
  if (record === undefined) {
    return emptyWorkflowGraph()
  }
  const normalized: WorkflowGraphEnvelope = {
    nodes: Array.isArray(record['nodes'])
      ? workflowContainerNodes(
          record['nodes'].filter(isWorkflowDefinitionNode).map(normalizePersistedNode),
        )
      : [],
    edges: Array.isArray(record['edges']) ? record['edges'].filter(isWorkflowDefinitionEdge) : [],
    viewport: isWorkflowViewport(record['viewport']) ? record['viewport'] : DEFAULT_VIEWPORT,
    annotations: Array.isArray(record['annotations'])
      ? record['annotations'].filter(isWorkflowGraphAnnotation)
      : [],
    globalVariables: Array.isArray(record['globalVariables'])
      ? record['globalVariables'].filter(isWorkflowGlobalVariable)
      : [],
    ...(typeof record['description'] === 'string' ? { description: record['description'] } : {}),
  }
  // Merge the raw record underneath, so a field a future version added survives a resave;
  // only the geometry the editor understands is normalized on top of it.
  return Object.assign({}, record, normalized)
}

/** Converts a backend epoch-millis timestamp into the editor's ISO string form. */
export function workflowTimestampToIso(millis: bigint | number): string {
  return new Date(Number(millis)).toISOString()
}

/** Converts the editor's ISO timestamp into the backend's epoch-millis form. */
export function isoToWorkflowTimestamp(iso: string): bigint {
  return BigInt(Date.parse(iso))
}
