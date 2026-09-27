import { describe, expect, it } from 'vitest'
import {
  normalizeWorkflowDefinition,
  normalizeWorkflowDocument,
  validateWorkflowDefinition,
  type WorkflowDefinitionInput,
} from '@/features/workflows/runtime/definition'
import {
  parseWorkflowGraph,
  serializeWorkflowGraph,
} from '@/features/workflows/runtime/graph-codec'
import type { WorkflowDefinitionNode } from '@/features/workflows/runtime/types'

/** Builds a document input around the parts a test varies, so each case states only its subject. */
function documentWith(parts: {
  id?: string
  nodes: WorkflowDefinitionInput['nodes']
  edges?: WorkflowDefinitionInput['edges']
  viewport?: WorkflowDefinitionInput['viewport']
  globalVariables?: WorkflowDefinitionInput['globalVariables']
}): WorkflowDefinitionInput {
  return {
    id: parts.id ?? 'workflow',
    name: 'Workflow',
    description: '',
    updatedAt: '2026-09-20T12:00:00+08:00',
    viewport: parts.viewport ?? { x: 0, y: 0, zoom: 1 },
    nodes: parts.nodes,
    edges: parts.edges ?? [],
    ...(parts.globalVariables === undefined ? {} : { globalVariables: parts.globalVariables }),
  }
}

const START_NODE = {
  id: 'start',
  position: { x: 0, y: 0 },
  data: { kind: 'start' as const, title: 'Start', description: '' },
}

const SPARE_NODE = {
  id: 'spare',
  position: { x: 0, y: 100 },
  data: { kind: 'agent' as const, title: 'Spare', description: '' },
}

describe('authoring document normalization', () => {
  it('preserves spare cycles through persistence while executable validation remains strict', () => {
    const definition = normalizeWorkflowDocument(
      documentWith({
        nodes: [START_NODE, SPARE_NODE],
        edges: [{ id: 'cycle', source: 'spare', target: 'spare' }],
      }),
    )
    const restored = parseWorkflowGraph(serializeWorkflowGraph(definition))

    expect({ nodes: restored.nodes, edges: restored.edges }).toEqual({
      nodes: definition.nodes,
      edges: definition.edges,
    })
    expect(() => validateWorkflowDefinition(definition)).toThrow('graph must be acyclic')
  })

  it('rejects a document whose graph is cyclic when the executable contract is requested', () => {
    const input = documentWith({
      nodes: [START_NODE, SPARE_NODE],
      edges: [{ id: 'cycle', source: 'spare', target: 'spare' }],
    })

    expect(() => normalizeWorkflowDefinition(input)).toThrow('graph must be acyclic')
  })

  it('accepts a document whose graph is acyclic', () => {
    const definition = normalizeWorkflowDefinition(
      documentWith({
        nodes: [START_NODE, SPARE_NODE],
        edges: [{ id: 'e1', source: 'start', target: 'spare' }],
      }),
    )

    expect(definition.nodes).toHaveLength(2)
    expect(definition.edges).toHaveLength(1)
  })

  it('rejects an unnamed definition and one with no nodes', () => {
    expect(() =>
      normalizeWorkflowDocument(documentWith({ id: '  ', nodes: [START_NODE] })),
    ).toThrow('definition id must not be empty')
    expect(() => normalizeWorkflowDocument(documentWith({ nodes: [] }))).toThrow(
      'at least one node is required',
    )
  })

  it('rejects nodes with empty, duplicate, or non-finite identity', () => {
    const unnamed = { ...SPARE_NODE, id: '   ' }
    const duplicated = { ...SPARE_NODE, id: 'start' }
    const unplaced = { ...SPARE_NODE, position: { x: Number.NaN, y: 0 } }

    expect(() => normalizeWorkflowDocument(documentWith({ nodes: [START_NODE, unnamed] }))).toThrow(
      'node id must not be empty',
    )
    expect(() =>
      normalizeWorkflowDocument(documentWith({ nodes: [START_NODE, duplicated] })),
    ).toThrow('duplicate node id start')
    expect(() =>
      normalizeWorkflowDocument(documentWith({ nodes: [START_NODE, unplaced] })),
    ).toThrow('has a non-finite position')
  })

  it('rejects edges with empty, duplicate, or unknown endpoints', () => {
    const nodes = [START_NODE, SPARE_NODE]

    expect(() =>
      normalizeWorkflowDocument(
        documentWith({ nodes, edges: [{ id: '  ', source: 'start', target: 'spare' }] }),
      ),
    ).toThrow('edge id must not be empty')
    expect(() =>
      normalizeWorkflowDocument(
        documentWith({
          nodes,
          edges: [
            { id: 'e1', source: 'start', target: 'spare' },
            { id: 'e1', source: 'start', target: 'spare' },
          ],
        }),
      ),
    ).toThrow('duplicate edge id e1')
    expect(() =>
      normalizeWorkflowDocument(
        documentWith({ nodes, edges: [{ id: 'e1', source: 'start', target: 'ghost' }] }),
      ),
    ).toThrow('references an unknown node')
  })

  it('rejects a viewport that is not finite or not positively zoomed', () => {
    expect(() =>
      normalizeWorkflowDocument(
        documentWith({ nodes: [START_NODE], viewport: { x: 0, y: 0, zoom: 0 } }),
      ),
    ).toThrow('viewport must contain finite coordinates and a positive zoom')
    expect(() =>
      normalizeWorkflowDocument(
        documentWith({ nodes: [START_NODE], viewport: { x: Number.NaN, y: 0, zoom: 1 } }),
      ),
    ).toThrow('viewport must contain finite coordinates and a positive zoom')
  })

  it('reports every issue it found rather than only the first', () => {
    expect(() =>
      normalizeWorkflowDocument(
        documentWith({ id: '', nodes: [], viewport: { x: 0, y: 0, zoom: 0 } }),
      ),
    ).toThrow(
      'definition id must not be empty; at least one node is required; viewport must contain finite coordinates and a positive zoom',
    )
  })
})

describe('authoring document normalization of individual fields', () => {
  it('migrates a legacy Start instruction into the input field', () => {
    const definition = normalizeWorkflowDocument(
      documentWith({
        nodes: [
          {
            id: 'start',
            position: { x: 0, y: 0 },
            data: { kind: 'start', title: 'Start', description: '', instruction: 'Kick off' },
          },
        ],
      }),
    )

    expect(definition.nodes.at(0)?.data.input).toBe('Kick off')
    expect(definition.nodes.at(0)?.data.instruction).toBeUndefined()
  })

  it('keeps an existing Start input rather than the legacy instruction', () => {
    const definition = normalizeWorkflowDocument(
      documentWith({
        nodes: [
          {
            id: 'start',
            position: { x: 0, y: 0 },
            data: {
              kind: 'start',
              title: 'Start',
              description: '',
              input: 'Authored',
              instruction: 'Stale',
            },
          },
        ],
      }),
    )

    expect(definition.nodes.at(0)?.data.input).toBe('Authored')
  })

  it('clones global variables so later edits cannot reach the persisted copy', () => {
    const variables = [{ name: 'sys.tenant', valueType: 'string' as const, value: { id: 1 } }]
    const definition = normalizeWorkflowDocument(
      documentWith({ nodes: [START_NODE], globalVariables: variables }),
    )

    expect(definition.globalVariables).toEqual(variables)
    expect(definition.globalVariables?.at(0)).not.toBe(variables.at(0))
  })

  it('pins the React Flow node type and carries container layout fields through', () => {
    const definition = normalizeWorkflowDocument(
      documentWith({
        nodes: [
          {
            id: 'loop',
            type: 'default',
            position: { x: 200, y: 0 },
            data: { kind: 'loop', title: 'Refine', description: '' },
            width: 320,
            height: 180,
          },
          {
            id: 'child',
            position: { x: 40, y: 60 },
            data: { kind: 'agent', title: 'Refine draft', description: '', containerId: 'loop' },
          },
        ],
      }),
    )

    expect(definition.nodes.map((node: WorkflowDefinitionNode) => node.type)).toEqual([
      'workflow',
      'workflow',
    ])
    expect(definition.nodes.at(0)?.initialWidth).toBe(320)
    expect(definition.nodes.at(0)?.initialHeight).toBe(180)
    expect(definition.nodes.at(1)?.parentId).toBe('loop')
  })

  it('keeps string edge labels and handles, and drops labels of other types', () => {
    const definition = normalizeWorkflowDocument(
      documentWith({
        nodes: [START_NODE, SPARE_NODE],
        edges: [
          {
            id: 'e1',
            source: 'start',
            target: 'spare',
            type: 'workflow',
            label: 'yes',
            sourceHandle: 'case-1',
            targetHandle: 'in',
            data: { tone: 'positive' },
          },
          { id: 'e2', source: 'start', target: 'spare', label: 42 },
        ],
      }),
    )

    expect(definition.edges.at(0)).toEqual({
      id: 'e1',
      source: 'start',
      target: 'spare',
      type: 'workflow',
      label: 'yes',
      sourceHandle: 'case-1',
      targetHandle: 'in',
      data: { tone: 'positive' },
    })
    expect(definition.edges.at(1)).toEqual({ id: 'e2', source: 'start', target: 'spare' })
  })
})
