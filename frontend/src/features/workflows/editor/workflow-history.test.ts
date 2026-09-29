import { describe, expect, it } from 'vitest'
import type {
  WorkflowCanvasEdge,
  WorkflowCanvasNode,
} from '@/features/workflows/editor/canvas-types'
import {
  commitWorkflowHistory,
  createWorkflowHistoryState,
  redoWorkflowHistory,
  undoWorkflowHistory,
  workflowHistoryFingerprint,
  type WorkflowHistorySnapshot,
  type WorkflowHistoryState,
  type WorkflowHistoryStep,
} from '@/features/workflows/editor/workflow-history'

/** One authored card the fixture graphs use. */
function nodeCard(id: string, x = 0): WorkflowCanvasNode {
  return {
    id,
    type: 'workflow',
    position: { x, y: 0 },
    data: { kind: 'agent', title: `Agent ${id}`, description: '' },
  }
}

/** One edge between two fixture cards. */
function link(source: string, target: string): WorkflowCanvasEdge {
  return { id: `edge-${source}-to-${target}`, source, target }
}

/** A snapshot holding exactly the cards and links the caller lists. */
function graph(
  nodes: WorkflowCanvasNode[],
  edges: WorkflowCanvasEdge[] = [],
): WorkflowHistorySnapshot {
  return { nodes, edges, annotations: [], globalVariables: [], launchFields: [] }
}

/** True only for commit results where the two fields differ as required. */
function diff(changes: {
  before: WorkflowHistorySnapshot
  after: WorkflowHistorySnapshot
}): boolean {
  return workflowHistoryFingerprint(changes.before) !== workflowHistoryFingerprint(changes.after)
}

/** A single-agent graph for most assertions. */
function baseGraph(): WorkflowHistorySnapshot {
  return graph([nodeCard('first')])
}

/** A graph whose only card moved, simulating a re-layout. */
function movedGraph(): WorkflowHistorySnapshot {
  return graph([nodeCard('first', 40)])
}

describe('createWorkflowHistoryState', () => {
  it('starts with empty stacks', () => {
    expect(createWorkflowHistoryState()).toEqual({ past: [], future: [] })
  })
})

describe('workflowHistoryFingerprint', () => {
  it('is stable across separately built but equal snapshots', () => {
    const first = graph([nodeCard('a')])
    const second = graph([nodeCard('a')])
    expect(workflowHistoryFingerprint(first)).toBe(workflowHistoryFingerprint(second))
  })

  it('changes when a card moves', () => {
    const first = graph([nodeCard('a')])
    const second = graph([nodeCard('a', 80)])
    expect(first).not.toEqual(second)
    expect(workflowHistoryFingerprint(first)).not.toBe(workflowHistoryFingerprint(second))
  })

  it('changes when one edge is added', () => {
    const first = graph([nodeCard('a'), nodeCard('b')])
    const second = graph([nodeCard('a'), nodeCard('b')], [link('a', 'b')])
    expect(workflowHistoryFingerprint(first)).not.toBe(workflowHistoryFingerprint(second))
  })
})

describe('commitWorkflowHistory', () => {
  it('stores the before-state as the step for an edit', () => {
    const state = commitWorkflowHistory(createWorkflowHistoryState(), {
      before: baseGraph(),
      after: movedGraph(),
      event: 'node.move',
      meta: { nodeIds: ['first'], subject: 'Agent first' },
    })
    expect(state.past).toHaveLength(1)
    expect(state.future).toHaveLength(0)
    const step = state.past[0]
    expect(step).toBeDefined()
    expect(step?.event).toBe('node.move')
    expect(step?.snapshot).toEqual(baseGraph())
    expect(step?.meta).toEqual({ nodeIds: ['first'], subject: 'Agent first' })
    expect(step?.id).toEqual(expect.any(String))
  })

  it('ignores a semantic no-op', () => {
    const state = commitWorkflowHistory(createWorkflowHistoryState(), {
      before: baseGraph(),
      after: baseGraph(),
      event: 'node.move',
    })
    expect(state.past).toHaveLength(0)
  })

  it('drops the optional meta when none was given', () => {
    const state = commitWorkflowHistory(createWorkflowHistoryState(), {
      before: baseGraph(),
      after: movedGraph(),
      event: 'node.move',
    })
    expect(state.past[0]?.meta).toBeUndefined()
  })

  it('honours a caller-supplied id for test assertions', () => {
    const state = commitWorkflowHistory(createWorkflowHistoryState(), {
      before: baseGraph(),
      after: movedGraph(),
      event: 'node.add',
      id: 'step-a',
    })
    expect(state.past[0]?.id).toBe('step-a')
  })

  it('wipes redo history on a fresh edit', () => {
    let state: WorkflowHistoryState = createWorkflowHistoryState()
    state = commitWorkflowHistory(state, {
      before: baseGraph(),
      after: movedGraph(),
      event: 'node.move',
    })
    state = commitWorkflowHistory(state, {
      before: movedGraph(),
      after: graph([nodeCard('first'), nodeCard('second')]),
      event: 'node.add',
    })
    const undid = undoWorkflowHistory(state, graph([nodeCard('first'), nodeCard('second')]))
    expect(undid.state.future).toHaveLength(1)
    const afterNewEdit = commitWorkflowHistory(undid.state, {
      before: undid.snapshot ?? baseGraph(),
      after: graph([nodeCard('first'), nodeCard('second'), nodeCard('third')]),
      event: 'node.add',
    })
    expect(afterNewEdit.past).toHaveLength(2)
    expect(afterNewEdit.future).toHaveLength(0)
  })

  it('caps the undo stack at fifty steps', () => {
    let state: WorkflowHistoryState = createWorkflowHistoryState()
    let current = baseGraph()
    for (let index = 0; index < 55; index += 1) {
      const next = graph([nodeCard('first', index)])
      state = commitWorkflowHistory(state, {
        before: current,
        after: next,
        event: 'node.move',
      })
      current = next
    }
    expect(state.past).toHaveLength(50)
  })
})

describe('undoWorkflowHistory', () => {
  it('returns the before-state and parks the current content in redo', () => {
    let state = commitWorkflowHistory(createWorkflowHistoryState(), {
      before: baseGraph(),
      after: movedGraph(),
      event: 'node.move',
    })
    const current = movedGraph()
    const result = undoWorkflowHistory(state, current)
    expect(result.state.past).toHaveLength(0)
    expect(result.state.future).toHaveLength(1)
    expect(result.snapshot).toEqual(baseGraph())
    expect(result.state.future[0]?.snapshot).toEqual(current)
  })

  it('does nothing on an empty past', () => {
    const state = createWorkflowHistoryState()
    const result = undoWorkflowHistory(state, baseGraph())
    expect(result.snapshot).toBeNull()
    expect(result.state).toBe(state)
  })
})

describe('redoWorkflowHistory', () => {
  it('returns the redo step and parks the current content in undo', () => {
    let state = createWorkflowHistoryState()
    state = commitWorkflowHistory(state, {
      before: baseGraph(),
      after: movedGraph(),
      event: 'node.move',
    })
    const undid = undoWorkflowHistory(state, movedGraph())
    const result = redoWorkflowHistory(undid.state, undid.snapshot ?? baseGraph())
    expect(result.state.past).toHaveLength(1)
    expect(result.state.future).toHaveLength(0)
    expect(result.snapshot).toEqual(movedGraph())
    expect(result.state.past[0]?.snapshot).toEqual(baseGraph())
  })

  it('does nothing on an empty future', () => {
    const result = redoWorkflowHistory(createWorkflowHistoryState(), baseGraph())
    expect(result.snapshot).toBeNull()
    expect(result.state.past).toHaveLength(0)
  })
})

describe('round-trips', () => {
  it('commit → undo → redo returns exactly the intermediate contents', () => {
    const before = baseGraph()
    const editStep: WorkflowHistoryStep = {
      id: 'step-1',
      event: 'node.move',
      snapshot: before,
      fingerprint: workflowHistoryFingerprint(before),
    }
    let state: WorkflowHistoryState = { past: [editStep], future: [] }
    const current = movedGraph()

    const undid = undoWorkflowHistory(state, current)
    expect(undid.snapshot).toEqual(before)

    const redid = redoWorkflowHistory(undid.state, undid.snapshot ?? current)
    expect(redid.snapshot).toEqual(current)
    expect(redid.state.past.map((step) => step.event)).toEqual(['node.move'])
  })

  it('reports a diff for edited graphs and not for identical ones', () => {
    expect(diff({ before: baseGraph(), after: movedGraph() })).toBe(true)
    expect(diff({ before: baseGraph(), after: baseGraph() })).toBe(false)
  })
})
