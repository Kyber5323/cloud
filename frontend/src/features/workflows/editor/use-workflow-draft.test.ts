import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Workflow } from '@/api/generated.schemas'
import type { WorkflowNodeTranslator } from '@/features/workflows/runtime/node-factory'
import { useWorkflowDraft } from '@/features/workflows/editor/use-workflow-draft'
import type { WorkflowCanvasNode } from '@/features/workflows/editor/canvas-types'
import { workflowFixture } from '@/test/cloud-handlers'

/** A translator that echoes catalogue keys, matching the tests' node titles. */
const translate: WorkflowNodeTranslator = (key) => key

/** An iteration frame that owns the members below it. */
function iterationNode(): WorkflowCanvasNode {
  return {
    id: 'iteration-1',
    type: 'workflow',
    position: { x: 0, y: 0 },
    data: { kind: 'iteration', title: '迭代 1', description: '' },
  }
}

/** An agent member living inside the iteration frame. */
function agentMember(): WorkflowCanvasNode {
  return {
    id: 'agent-1',
    type: 'workflow',
    position: { x: 120, y: 100 },
    parentId: 'iteration-1',
    data: { kind: 'agent', title: 'Agent 1', description: '' },
  }
}

/** A card sitting outside the region. */
function outputNode(): WorkflowCanvasNode {
  return {
    id: 'output-1',
    type: 'workflow',
    position: { x: 900, y: 0 },
    data: { kind: 'output', title: '输出 1', description: '' },
  }
}

/** A stored workflow whose graph holds exactly these nodes, and nothing else. */
function fixtureWithGraph(nodes: WorkflowCanvasNode[]): Workflow {
  return workflowFixture({
    graph: { nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  })
}

/** A graph with one iteration frame and one outside card. */
function draftFixture(): Workflow {
  return fixtureWithGraph([iterationNode(), outputNode()])
}

/** The graph an iteration frame and its member live in. */
function regionFixture(): Workflow {
  return fixtureWithGraph([iterationNode(), agentMember(), outputNode()])
}

/** A stored workflow whose graph carries this launch-field declaration. */
function declarationFixture(launchFields: unknown[]): Workflow {
  return workflowFixture({
    graph: {
      nodes: [outputNode()],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      launchFields,
    },
  })
}

function setup(workflow: Workflow) {
  return renderHook(() => useWorkflowDraft(workflow, translate))
}

/** Fails the test (rather than returning `undefined`) when the node is absent. */
function requireNode(nodes: WorkflowCanvasNode[], id: string): WorkflowCanvasNode {
  const found = nodes.find((node) => node.id === id)
  if (found === undefined) {
    throw new Error(`expected a draft node named "${id}"`)
  }
  return found
}

describe('useWorkflowDraft', () => {
  it('adds a member through the entry seam, widening the frame and wiring the entry edge', () => {
    const { result } = setup(draftFixture())

    act(() => {
      result.current.addIterationMember({ type: 'entry', iterationId: 'iteration-1' }, 'agent')
    })

    const member = result.current.nodes.find((node) => node.id === 'agent-1')
    expect(member?.parentId).toBe('iteration-1')
    expect(member?.data.kind).toBe('agent')
    expect(result.current.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'iteration-1',
          sourceHandle: 'iteration-entry',
          target: 'agent-1',
        }),
      ]),
    )
    const frame = result.current.nodes.find((node) => node.id === 'iteration-1')
    expect(frame?.initialHeight).toBeGreaterThanOrEqual(340)
  })

  it('leaves the graph alone when inserting into a missing iteration id', () => {
    const { result } = setup(draftFixture())

    act(() => {
      result.current.addIterationMember({ type: 'entry', iterationId: 'no-such' }, 'agent')
    })

    expect(result.current.nodes).toHaveLength(2)
    expect(result.current.edges).toHaveLength(0)
  })

  it('folds and unfolds a frame without touching membership', () => {
    const { result } = setup(regionFixture())

    act(() => {
      result.current.toggleIterationCollapsed('iteration-1')
    })
    let frame = result.current.nodes.find((node) => node.id === 'iteration-1')
    expect(frame?.data.collapsed).toBe(true)
    expect(result.current.nodes).toHaveLength(3)

    act(() => {
      result.current.toggleIterationCollapsed('iteration-1')
    })
    frame = result.current.nodes.find((node) => node.id === 'iteration-1')
    expect(frame?.data.collapsed).toBe(false)
  })

  it('strips presentation fields when a correction arrives from the canvas', () => {
    const { result } = setup(regionFixture())
    const frame = result.current.nodes.find((node) => node.id === 'iteration-1')
    if (frame === undefined) {
      throw new Error('the iteration frame should be present')
    }
    const presented: WorkflowCanvasNode[] = [
      {
        ...frame,
        extent: 'parent',
        hidden: true,
        zIndex: 0,
        data: { ...frame.data, regionMemberCount: 1 },
      },
    ]

    act(() => {
      result.current.applyCorrection(presented)
    })

    const node = result.current.nodes.find((candidate) => candidate.id === 'iteration-1')
    expect(node?.extent).toBeUndefined()
    expect(node?.hidden).toBeUndefined()
    expect(node?.zIndex).toBeUndefined()
    expect(node?.data.regionMemberCount).toBeUndefined()
  })

  it('mirrors a manual frame resize onto the persisted frame size', () => {
    const { result } = setup(draftFixture())

    act(() => {
      result.current.applyNodeChanges([
        {
          type: 'dimensions',
          id: 'iteration-1',
          resizing: true,
          dimensions: { width: 700, height: 400 },
        },
      ])
    })

    const frame = result.current.nodes.find((node) => node.id === 'iteration-1')
    expect(frame?.initialWidth).toBe(700)
    expect(frame?.initialHeight).toBe(400)
  })

  it('does not treat a selection toggle as an authored change', () => {
    const { result } = setup(regionFixture())

    act(() => {
      result.current.applyNodeChanges([{ type: 'select', id: 'agent-1', selected: true }])
    })

    const member = result.current.nodes.find((node) => node.id === 'agent-1')
    expect(member?.selected).toBe(true)
    expect(result.current.nodes).toHaveLength(3)
  })

  it('clears a collect target after the member holding it is removed', () => {
    // The fixture nodes are shared with the stored graph, so the authored
    // collect selector can be placed on the frame before the draft seeds.
    const nodes = [iterationNode(), agentMember(), outputNode()]
    const frameNode = nodes.find((node) => node.id === 'iteration-1')
    if (frameNode !== undefined) {
      frameNode.data = {
        ...frameNode.data,
        iterationConfig: {
          iteratorSelector: ['start', 'items'],
          collectSelector: ['agent-1', 'result'],
          errorStrategy: 'fail',
          maxIterations: 10,
        },
      }
    }
    const { result } = setup(fixtureWithGraph(nodes))

    act(() => {
      result.current.applyNodeChanges([{ type: 'remove', id: 'agent-1' }])
    })

    const frame = requireNode(result.current.nodes, 'iteration-1')
    expect(frame.data.kind).toBe('iteration')
    const data = frame.data as { iterationConfig?: { collectSelector?: string[] } }
    expect(data.iterationConfig?.collectSelector).toEqual([])
  })

  it('carries the launch-field declaration from the stored graph into the next save', () => {
    const declaration = [
      { key: 'version', enabled: false },
      { key: 'prompt', required: true },
    ]
    const { result } = setup(declarationFixture(declaration))

    expect(result.current.launchFields).toEqual(declaration)

    act(() => {
      result.current.replaceLaunchFields([{ key: 'repository', enabled: false }])
    })

    expect(result.current.launchFields).toEqual([{ key: 'repository', enabled: false }])
    expect(result.current.snapshot({ x: 0, y: 0, zoom: 1 })).toHaveProperty('launchFields', [
      { key: 'repository', enabled: false },
    ])
  })

  it('writes the launch-field key even when the workflow declares nothing', () => {
    const { result } = setup(draftFixture())

    // The key belongs to the envelope's shape rather than being an optional extra: the editor's
    // history fingerprint is a plain JSON.stringify of this document, so a key that appeared only
    // once it had content would make two identical states hash differently.
    expect(result.current.snapshot({ x: 0, y: 0, zoom: 1 })).toHaveProperty('launchFields', [])
  })

  it('keeps the launch-field declaration through a history capture and restore', () => {
    const declaration = [{ key: 'branch', required: false }]
    const { result } = setup(declarationFixture(declaration))

    const captured = result.current.captureContent()
    expect(captured.launchFields).toEqual(declaration)

    act(() => {
      result.current.replaceLaunchFields([])
    })
    expect(result.current.launchFields).toEqual([])

    act(() => {
      result.current.restoreContent(captured)
    })

    expect(result.current.launchFields).toEqual(declaration)
  })
})
