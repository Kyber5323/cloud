import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowCanvasNode } from '@/features/workflows/editor/canvas-types'
import { useWorkflowHistory } from '@/features/workflows/editor/use-workflow-history'
import type { WorkflowHistorySnapshot } from '@/features/workflows/editor/workflow-history'

/** An output card; its title distinguishes it from the engine-test agent cards. */
function outputCard(id: string, y = 0): WorkflowCanvasNode {
  return {
    id,
    type: 'workflow',
    position: { x: 0, y },
    data: { kind: 'output', title: `Result ${id}`, description: 'collected' },
  }
}

/** A snapshot whose context carries the phrase "histories recording" when set. */
function snapshotOf(cards: WorkflowCanvasNode[]): WorkflowHistorySnapshot {
  return { nodes: cards, edges: [], annotations: [], globalVariables: [], launchFields: [] }
}

const INITIAL = snapshotOf([outputCard('one')])
const MOVED = snapshotOf([outputCard('one', 20)])
const PAIRED = snapshotOf([outputCard('one'), outputCard('two')])

/** Mounts the recorder and spies on the restore sink its steps land on. */
function setup() {
  const onRestore = vi.fn<(snapshot: WorkflowHistorySnapshot) => void>()
  const rendered = renderHook(() => useWorkflowHistory(onRestore))
  return { onRestore, rendered }
}

/** Asserts the history surface sits at its initial, empty state. */
function expectEmptyHistory(rendered: ReturnType<typeof setup>['rendered']): void {
  expect(rendered.result.current.canUndo).toBe(false)
  expect(rendered.result.current.canRedo).toBe(false)
  expect(rendered.result.current.past).toHaveLength(0)
  expect(rendered.result.current.future).toHaveLength(0)
  expect(rendered.result.current.currentEvent).toBeNull()
}

/** Records one edit through the hook's own surface, inside an act boundary. */
function record(
  rendered: ReturnType<typeof setup>['rendered'],
  before: WorkflowHistorySnapshot,
  after: WorkflowHistorySnapshot,
  group?: string,
): void {
  act(() => {
    rendered.result.current.record(
      before,
      after,
      'node.edit',
      group === undefined ? undefined : { group },
    )
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useWorkflowHistory', () => {
  it('starts with nothing to undo or redo', () => {
    const { rendered } = setup()
    expectEmptyHistory(rendered)
  })

  it('records one step per completed edit and raises the current event', () => {
    const { rendered } = setup()
    record(rendered, INITIAL, MOVED)
    expect(rendered.result.current.past).toHaveLength(1)
    expect(rendered.result.current.canUndo).toBe(true)
    expect(rendered.result.current.canRedo).toBe(false)
    expect(rendered.result.current.currentEvent).toBe('node.edit')
  })

  it('ignores an edit whose content did not change', () => {
    const { rendered } = setup()
    record(rendered, INITIAL, INITIAL)
    expect(rendered.result.current.past).toHaveLength(0)
    expect(rendered.result.current.canUndo).toBe(false)
  })

  it('merges keystrokes of the same focused field into one step', () => {
    const { rendered } = setup()
    record(rendered, INITIAL, MOVED, 'title')
    record(rendered, MOVED, PAIRED, 'title')
    expect(rendered.result.current.past).toHaveLength(1)
    expect(rendered.result.current.currentEvent).toBe('node.edit')
  })

  it('keeps edits on separate fields as separate steps', () => {
    const { rendered } = setup()
    record(rendered, INITIAL, MOVED, 'title')
    record(rendered, MOVED, PAIRED, 'command')
    expect(rendered.result.current.past).toHaveLength(2)
  })

  it('starts a new step when the coalescing window passes', () => {
    const { rendered } = setup()
    record(rendered, INITIAL, MOVED, 'title')
    vi.advanceTimersByTime(600)
    record(rendered, MOVED, PAIRED, 'title')
    expect(rendered.result.current.past).toHaveLength(2)
  })

  it('closes the window on demand when a text editor loses focus', () => {
    const { rendered } = setup()
    record(rendered, INITIAL, MOVED, 'title')
    act(() => {
      rendered.result.current.endGroup()
    })
    record(rendered, MOVED, PAIRED, 'title')
    expect(rendered.result.current.past).toHaveLength(2)
  })

  it('undo restores the previous snapshot and hands the current one to redo', () => {
    const { rendered, onRestore } = setup()
    record(rendered, INITIAL, MOVED)
    let restored = false
    act(() => {
      restored = rendered.result.current.undo(PAIRED)
    })
    expect(restored).toBe(true)
    expect(onRestore).toHaveBeenCalledWith(INITIAL)
    expect(rendered.result.current.canUndo).toBe(false)
    expect(rendered.result.current.canRedo).toBe(true)
    expect(rendered.result.current.future).toHaveLength(1)
    expect(rendered.result.current.currentEvent).toBeNull()
  })

  it('redo re-applies the parked step', () => {
    const { rendered, onRestore } = setup()
    record(rendered, INITIAL, MOVED)
    act(() => {
      rendered.result.current.undo(PAIRED)
    })
    let restored = false
    act(() => {
      restored = rendered.result.current.redo(INITIAL)
    })
    expect(restored).toBe(true)
    expect(onRestore).toHaveBeenLastCalledWith(PAIRED)
    expect(rendered.result.current.canUndo).toBe(true)
    expect(rendered.result.current.canRedo).toBe(false)
  })

  it('undo with nothing to undo leaves the content untouched', () => {
    const { rendered, onRestore } = setup()
    let restored = true
    act(() => {
      restored = rendered.result.current.undo(PAIRED)
    })
    expect(restored).toBe(false)
    expect(onRestore).not.toHaveBeenCalled()
  })

  it('jump leaps across several steps in one render', () => {
    const { rendered, onRestore } = setup()
    record(rendered, INITIAL, MOVED)
    record(rendered, MOVED, PAIRED)
    const FAR = snapshotOf([outputCard('one', 40)])
    let restored = false
    act(() => {
      restored = rendered.result.current.jump(FAR, 'past', 2)
    })
    expect(restored).toBe(true)
    expect(onRestore).toHaveBeenCalledWith(INITIAL)
    expect(rendered.result.current.canUndo).toBe(false)
    expect(rendered.result.current.future).toHaveLength(2)
  })

  it('commits one transaction as a single step when its content differs', () => {
    const { rendered } = setup()
    act(() => {
      rendered.result.current.beginTransaction(INITIAL, 'node.move', { subject: 'move-all' })
    })
    act(() => {
      rendered.result.current.commitTransaction(MOVED)
    })
    expect(rendered.result.current.past).toHaveLength(1)
    expect(rendered.result.current.past[0]?.event).toBe('node.move')
    expect(rendered.result.current.past[0]?.meta?.subject).toBe('move-all')
  })

  it('drops a transaction whose content never changed', () => {
    const { rendered } = setup()
    act(() => {
      rendered.result.current.beginTransaction(INITIAL, 'node.move')
    })
    act(() => {
      rendered.result.current.commitTransaction(INITIAL)
    })
    expect(rendered.result.current.past).toHaveLength(0)
  })

  it('clear empties the stacks and the current event', () => {
    const { rendered } = setup()
    record(rendered, INITIAL, MOVED)
    act(() => {
      rendered.result.current.clear()
    })
    expectEmptyHistory(rendered)
  })
})
