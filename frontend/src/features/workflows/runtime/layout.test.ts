import { describe, expect, it } from 'vitest'
import {
  WORKFLOW_FLOW_EDGE_TYPE,
  WORKFLOW_FLOW_NODE_TYPE,
  WORKFLOW_SNAP_GRID,
  isAuthoredNodeChange,
  nodePositionAt,
  organizeWorkflowNodes,
  snapNodePosition,
  type WorkflowLayoutNode,
} from '@/features/workflows/runtime/layout'

/** One node of the default size, at a given vertical position. */
function node(id: string, y = 0, overrides: Partial<WorkflowLayoutNode> = {}): WorkflowLayoutNode {
  return {
    id,
    position: { x: 0, y },
    data: { kind: 'agent', title: id, description: '' },
    ...overrides,
  }
}

/** An edge, in the shape the layout only reads endpoints from. */
function edge(source: string, target: string) {
  return { source, target }
}

/** The position the layout gave `id`, or a failure naming the node that went missing. */
function positionOf(nodes: readonly WorkflowLayoutNode[], id: string) {
  const found = nodes.find((candidate) => candidate.id === id)
  if (found === undefined) {
    throw new Error(`layout dropped node "${id}"`)
  }
  return found.position
}

describe('nodePositionAt', () => {
  it('centers a card around the point, at handle height', () => {
    expect(nodePositionAt({ x: 500, y: 300 })).toEqual({ x: 385, y: 239 })
  })
})

describe('snapNodePosition', () => {
  it('aligns a card to the grid the canvas draws', () => {
    expect(snapNodePosition({ x: 385, y: 239 })).toEqual({ x: 380, y: 240 })
  })

  it('snaps a negative position toward the same grid, not away from it', () => {
    expect(snapNodePosition({ x: 7, y: -13 })).toEqual({ x: 0, y: -20 })
  })
})

describe('isAuthoredNodeChange', () => {
  it('ignores an empty batch', () => {
    expect(isAuthoredNodeChange([])).toBe(false)
  })

  it('ignores selection, which is not a graph edit', () => {
    expect(isAuthoredNodeChange([{ type: 'select' }])).toBe(false)
  })

  it('ignores the size probe React Flow reports through the same channel', () => {
    expect(isAuthoredNodeChange([{ type: 'dimensions' }])).toBe(false)
  })

  it('reports a drag', () => {
    expect(isAuthoredNodeChange([{ type: 'position' }])).toBe(true)
  })

  it('reports an edit that shares a batch with a selection', () => {
    expect(isAuthoredNodeChange([{ type: 'select' }, { type: 'remove' }])).toBe(true)
  })
})

describe('workflow flow element types', () => {
  it('registers one element type for the nodes and the edges alike', () => {
    expect(WORKFLOW_FLOW_NODE_TYPE).toBe('workflow')
    expect(WORKFLOW_FLOW_EDGE_TYPE).toBe('workflow')
  })

  it('snaps to a two-dimensional grid', () => {
    expect(WORKFLOW_SNAP_GRID).toHaveLength(2)
  })
})

describe('organizeWorkflowNodes', () => {
  it('leaves an empty graph empty', () => {
    expect(organizeWorkflowNodes([], [])).toEqual([])
  })

  it('places each dependency rank in its own column, left to right', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d')]
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd')]

    const organized = organizeWorkflowNodes(nodes, edges)

    expect(positionOf(organized, 'a')).toEqual({ x: 0, y: 80 })
    expect(positionOf(organized, 'b')).toEqual({ x: 360, y: 0 })
    expect(positionOf(organized, 'c')).toEqual({ x: 360, y: 180 })
    expect(positionOf(organized, 'd')).toEqual({ x: 700, y: 80 })
  })

  it('orders a column by where its cards already sit, so a re-run is stable', () => {
    const nodes = [node('b', 200), node('c', 0)]
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('a', 'z')]

    const organized = organizeWorkflowNodes([...nodes, node('a'), node('z')], edges)

    expect(positionOf(organized, 'c').y).toBeLessThan(positionOf(organized, 'b').y)
  })

  it('breaks a tie in the same column by id', () => {
    const nodes = [node('b'), node('c')]

    const organized = organizeWorkflowNodes([...nodes, node('a')], [edge('a', 'b'), edge('a', 'c')])

    expect(positionOf(organized, 'b').y).toBeLessThan(positionOf(organized, 'c').y)
  })

  it('keeps a cycle on the canvas instead of looping forever', () => {
    const nodes = [node('x'), node('y')]
    const edges = [edge('x', 'y'), edge('y', 'x')]

    const organized = organizeWorkflowNodes(nodes, edges)

    expect(organized).toHaveLength(2)
    expect(positionOf(organized, 'x')).toEqual({ x: 0, y: 0 })
    expect(positionOf(organized, 'y')).toEqual({ x: 0, y: 180 })
  })

  it('ignores an edge whose endpoints are not in the graph', () => {
    const organized = organizeWorkflowNodes([node('a')], [edge('a', 'ghost'), edge('ghost', 'a')])

    expect(positionOf(organized, 'a')).toEqual({ x: 0, y: 0 })
  })

  it('keeps every other field of a node, so only the position moves', () => {
    const original = node('a', 0, { data: { kind: 'start', title: 'Kickoff', description: 'd' } })

    const [organized] = organizeWorkflowNodes([original], [])

    expect(organized?.data).toBe(original.data)
  })

  it('widens a column to the card React Flow measured', () => {
    const nodes = [
      node('n1', 0, { measured: { width: 100 } }),
      node('n2', 0, { width: 200 }),
      node('n3', 0, { initialWidth: 300 }),
      node('n4'),
    ]
    const edges = [edge('n1', 'n2'), edge('n2', 'n3'), edge('n3', 'n4')]

    const organized = organizeWorkflowNodes(nodes, edges)

    expect(positionOf(organized, 'n1').x).toBe(0)
    expect(positionOf(organized, 'n2').x).toBe(220)
    expect(positionOf(organized, 'n3').x).toBe(540)
    expect(positionOf(organized, 'n4').x).toBe(960)
  })

  it('centers a column against the tallest one, at the card height it measured', () => {
    const nodes = [
      node('tall', 0, { measured: { height: 200 } }),
      node('a', 0, { height: 100 }),
      node('b', 0, { initialHeight: 60 }),
      node('c'),
    ]
    const edges = [edge('tall', 'a'), edge('a', 'b'), edge('b', 'c')]

    const organized = organizeWorkflowNodes(nodes, edges)

    expect(positionOf(organized, 'tall').y).toBe(0)
    expect(positionOf(organized, 'a').y).toBe(60)
    expect(positionOf(organized, 'b').y).toBe(80)
    expect(positionOf(organized, 'c').y).toBe(60)
  })
})
