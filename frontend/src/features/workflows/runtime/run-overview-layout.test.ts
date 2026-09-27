import { describe, expect, it } from 'vitest'
import { createRunOverviewNodes } from '@/features/workflows/runtime/run-overview-layout'
import type { WorkflowDefinitionNode } from '@/features/workflows/runtime/types'

/** A minimal frozen snapshot node; the overview paints status over this. */
function frozen(
  kind: 'agent' | 'loop' | 'iteration',
  id: string,
  containerId?: string,
): WorkflowDefinitionNode {
  return {
    id,
    type: 'workflow',
    position: { x: 0, y: 0 },
    data: {
      kind,
      title: id,
      description: '',
      ...(containerId === undefined ? {} : { containerId }),
    },
  }
}

describe('createRunOverviewNodes', () => {
  it('pins the workflow node type and read-only flags on every node', () => {
    const [node] = createRunOverviewNodes([frozen('agent', 'a-1')], {})
    expect(node).toMatchObject({
      id: 'a-1',
      type: 'workflow',
      selectable: true,
      draggable: false,
      connectable: false,
      deletable: false,
    })
  })

  it('overlays the trace status and falls back to idle for a node the run never reached', () => {
    const nodes = createRunOverviewNodes([frozen('agent', 'a-1'), frozen('agent', 'a-2')], {
      'a-1': { status: 'succeeded' },
    })
    expect(nodes.find((n) => n.id === 'a-1')?.data.runStatus).toBe('succeeded')
    expect(nodes.find((n) => n.id === 'a-2')?.data.runStatus).toBe('idle')
  })

  it('keeps the container parent and marks its members as extent-bound children', () => {
    const nodes = createRunOverviewNodes(
      [frozen('agent', 'member', 'loop-1'), frozen('loop', 'loop-1')],
      {},
    )
    expect(nodes.map((n) => n.id)).toEqual(['loop-1', 'member'])
    expect(nodes.find((n) => n.id === 'member')).toMatchObject({
      extent: 'parent',
      parentId: 'loop-1',
    })
    expect(nodes.find((n) => n.id === 'loop-1')).not.toHaveProperty('extent')
  })

  it('pins the loop below its members in z-order', () => {
    const nodes = createRunOverviewNodes(
      [frozen('agent', 'member', 'loop-1'), frozen('loop', 'loop-1'), frozen('agent', 'outside')],
      {},
    )
    expect(nodes.find((n) => n.id === 'loop-1')?.zIndex).toBe(0)
    expect(nodes.find((n) => n.id === 'member')?.zIndex).toBe(1)
    expect(nodes.find((n) => n.id === 'outside')?.zIndex).toBe(1)
  })

  it('renders a pending run with an empty state map as every node idle', () => {
    const nodes = createRunOverviewNodes([frozen('agent', 'a-1')], undefined)
    expect(nodes[0]?.data.runStatus).toBe('idle')
  })
})
