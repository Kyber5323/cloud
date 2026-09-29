import type {
  WorkflowGlobalVariable,
  WorkflowLaunchField,
} from '@/features/workflows/runtime/types'
import type { WorkflowGraphAnnotation } from '@/features/workflows/runtime/graph-codec'
import type {
  WorkflowCanvasEdge,
  WorkflowCanvasNode,
} from '@/features/workflows/editor/canvas-types'

/**
 * Identifies the user-visible operation that produced a history step.
 *
 * Only the operations the cloud editor can author right now appear here; when a
 * working surface for global variables lands, its writes will raise
 * `workflow.variables` through the same channel.
 */
export type WorkflowHistoryEvent =
  | 'node.add'
  | 'node.delete'
  | 'edge.delete'
  | 'edge.connect'
  | 'node.move'
  | 'iteration.resize'
  | 'layout.organize'
  | 'node.edit'
  | 'workflow.variables'
  | 'workflow.launchFields'

/** Stores the workflow fields that represent authored content, excluding UI state. */
export interface WorkflowHistorySnapshot {
  nodes: WorkflowCanvasNode[]
  edges: WorkflowCanvasEdge[]
  annotations: readonly WorkflowGraphAnnotation[]
  globalVariables: readonly WorkflowGlobalVariable[]
  /**
   * Always present, even when empty: the fingerprint below is a plain JSON.stringify, so a key
   * that appears only once it has content would make two identical states hash differently.
   */
  launchFields: readonly WorkflowLaunchField[]
  description?: string
}

/** Adds stable context to a history step without coupling the engine to UI text. */
export interface WorkflowHistoryMeta {
  nodeIds?: string[]
  edgeIds?: string[]
  /** Human-readable affected workflow elements, captured at the edit boundary. */
  subject?: string
  nodeTitle?: string
  nodeKind?: string
}

/** Represents one completed authored edit and the state immediately before it. */
export interface WorkflowHistoryStep {
  id: string
  event: WorkflowHistoryEvent
  meta?: WorkflowHistoryMeta
  snapshot: WorkflowHistorySnapshot
  fingerprint: string
}

/** Holds the linear undo and redo stacks for one editor session. */
export interface WorkflowHistoryState {
  past: WorkflowHistoryStep[]
  future: WorkflowHistoryStep[]
}

/** Creates an empty history for a newly mounted workflow editor. */
export function createWorkflowHistoryState(): WorkflowHistoryState {
  return { past: [], future: [] }
}

/** Produces a deterministic comparison key for semantic workflow content. */
export function workflowHistoryFingerprint(snapshot: WorkflowHistorySnapshot): string {
  return JSON.stringify(snapshot)
}

/** Records a completed edit, ignoring semantic no-ops and invalidating redo history. */
export function commitWorkflowHistory(
  state: WorkflowHistoryState,
  changes: {
    before: WorkflowHistorySnapshot
    after: WorkflowHistorySnapshot
    event: WorkflowHistoryEvent
    meta?: WorkflowHistoryMeta
    id?: string
  },
): WorkflowHistoryState {
  const beforeFingerprint = workflowHistoryFingerprint(changes.before)
  if (beforeFingerprint === workflowHistoryFingerprint(changes.after)) {
    return state
  }
  const id = changes.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  // With `exactOptionalPropertyTypes` an explicit `undefined` is not a missing
  // optional, so the step keeps the property only when it was actually given.
  const step: WorkflowHistoryStep =
    changes.meta === undefined
      ? { id, event: changes.event, snapshot: changes.before, fingerprint: beforeFingerprint }
      : {
          id,
          event: changes.event,
          meta: changes.meta,
          snapshot: changes.before,
          fingerprint: beforeFingerprint,
        }
  const past = [...state.past, step]
  return {
    past: past.slice(-50),
    future: [],
  }
}

/** Moves one step backward and returns the snapshot that should become current. */
export function undoWorkflowHistory(
  state: WorkflowHistoryState,
  current: WorkflowHistorySnapshot,
): { state: WorkflowHistoryState; snapshot: WorkflowHistorySnapshot | null } {
  const step = state.past.at(-1)
  if (step === undefined) {
    return { state, snapshot: null }
  }
  return {
    state: {
      past: state.past.slice(0, -1),
      future: [
        ...state.future,
        {
          ...step,
          snapshot: current,
          fingerprint: workflowHistoryFingerprint(current),
        },
      ],
    },
    snapshot: step.snapshot,
  }
}

/** Moves one step forward and returns the snapshot that should become current. */
export function redoWorkflowHistory(
  state: WorkflowHistoryState,
  current: WorkflowHistorySnapshot,
): { state: WorkflowHistoryState; snapshot: WorkflowHistorySnapshot | null } {
  const step = state.future.at(-1)
  if (step === undefined) {
    return { state, snapshot: null }
  }
  return {
    state: {
      past: [
        ...state.past,
        {
          ...step,
          snapshot: current,
          fingerprint: workflowHistoryFingerprint(current),
        },
      ],
      future: state.future.slice(0, -1),
    },
    snapshot: step.snapshot,
  }
}
