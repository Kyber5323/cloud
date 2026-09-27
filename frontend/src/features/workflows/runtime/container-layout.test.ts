import { describe, expect, it } from 'vitest'
import { workflowContainerNodes } from '@/features/workflows/runtime/container-layout'
import type { WorkflowDefinitionNode } from '@/features/workflows/runtime/types'

describe('workflowContainerNodes', () => {
  it('derives React Flow parentage from container ownership and orders the parent first', () => {
    const child: WorkflowDefinitionNode = {
      id: 'child',
      type: 'workflow',
      position: { x: 40, y: 140 },
      data: { kind: 'agent', title: 'Child', description: '', containerId: 'loop' },
    }
    const outside: WorkflowDefinitionNode = {
      id: 'outside',
      type: 'workflow',
      position: { x: 800, y: 0 },
      data: { kind: 'agent', title: 'Outside', description: '' },
    }
    const loop: WorkflowDefinitionNode = {
      id: 'loop',
      type: 'workflow',
      position: { x: 200, y: 0 },
      data: { kind: 'loop', title: 'Loop', description: '' },
    }

    expect(workflowContainerNodes([child, outside, loop])).toEqual([
      loop,
      { ...child, parentId: 'loop' },
      outside,
    ])
  })

  it('does not invent parentage for a missing container', () => {
    const orphan: WorkflowDefinitionNode = {
      id: 'orphan',
      type: 'workflow',
      position: { x: 0, y: 0 },
      data: { kind: 'agent', title: 'Orphan', description: '', containerId: 'missing' },
    }

    expect(workflowContainerNodes([orphan])).toEqual([orphan])
  })
})
