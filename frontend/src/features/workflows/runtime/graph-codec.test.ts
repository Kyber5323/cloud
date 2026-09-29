import { describe, expect, it } from 'vitest'
import {
  isoToWorkflowTimestamp,
  parseWorkflowGraph,
  parseWorkflowGraphValue,
  serializeWorkflowGraph,
  serializeWorkflowGraphValue,
  workflowTimestampToIso,
} from '@/features/workflows/runtime/graph-codec'
import type { WorkflowGraphInput } from '@/features/workflows/runtime/graph-codec'
import type {
  WorkflowDefinitionEdge,
  WorkflowDefinitionNode,
  WorkflowLaunchField,
} from '@/features/workflows/runtime/types'

const node: WorkflowDefinitionNode = {
  id: 'start',
  type: 'workflow',
  position: { x: 12, y: 34 },
  data: { kind: 'start', title: 'Start', description: 'Receives input' },
}

const edge: WorkflowDefinitionEdge = {
  id: 'e1',
  source: 'start',
  target: 'agent-1',
  type: 'workflow',
}

/** The envelope a missing or unreadable graph collapses to. */
const EMPTY_ENVELOPE = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  annotations: [],
  globalVariables: [],
  launchFields: [],
}

describe('graph envelope codec', () => {
  it('round-trips nodes, edges, annotations, viewport, and description', () => {
    const annotation = {
      id: 'annotation-1',
      type: 'annotation' as const,
      position: { x: 48, y: 96 },
      width: 240,
      height: 140,
      data: { text: 'Review this branch', theme: 'yellow' as const },
    }
    // One document, written once. A round trip claims the parser hands back exactly what the
    // serializer was given, so writing the expectation out a second time would only be able to say
    // that the test agrees with itself.
    const document: WorkflowGraphInput = {
      nodes: [node],
      edges: [edge],
      annotations: [annotation],
      globalVariables: [{ name: 'sys.workflow_id', valueType: 'string' }],
      launchFields: [
        { key: 'version', enabled: false },
        { key: 'prompt', enabled: true, required: true },
      ],
      viewport: { x: 32, y: 64, zoom: 1.5 },
      description: 'A review flow',
    }

    expect(parseWorkflowGraph(serializeWorkflowGraph(document))).toEqual(document)
  })

  it('keeps a launch-field declaration through a parse and resave', () => {
    const declaration: WorkflowLaunchField[] = [{ key: 'repository', enabled: false }]

    // The declaration is a sibling of the globals rather than a node's data, so a graph that
    // carries one has to hand it back on the next save: the editor writes what it read.
    const parsed = parseWorkflowGraphValue(
      serializeWorkflowGraphValue({ ...EMPTY_ENVELOPE, launchFields: declaration }),
    )
    expect(parsed.launchFields).toEqual(declaration)
    expect(
      serializeWorkflowGraphValue({
        nodes: parsed.nodes,
        edges: parsed.edges,
        viewport: parsed.viewport,
        launchFields: parsed.launchFields,
      }),
    ).toHaveProperty('launchFields', declaration)
  })

  it('drops a declaration entry that does not name a platform launch field', () => {
    const parsed = parseWorkflowGraphValue({
      ...EMPTY_ENVELOPE,
      launchFields: [{ key: 'deploy_target', enabled: false }, { key: 'branch' }, 'nonsense'],
    })

    // A key the catalogue does not have cannot be declared about, and a declaration that is not
    // a list of entries is no declaration at all.
    expect(parsed.launchFields).toEqual([{ key: 'branch' }])
  })

  it('omits the description key when absent', () => {
    const graph = serializeWorkflowGraph({
      nodes: [node],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    })

    expect(JSON.parse(graph)).not.toHaveProperty('description')
    expect(parseWorkflowGraph(graph)).not.toHaveProperty('description')
    expect(parseWorkflowGraph(graph).annotations).toEqual([])
  })

  it('tolerates partial envelopes with missing arrays', () => {
    const graph = JSON.stringify({ viewport: { x: 5, y: 6, zoom: 1 } })

    expect(parseWorkflowGraph(graph)).toEqual({
      nodes: [],
      edges: [],
      viewport: { x: 5, y: 6, zoom: 1 },
      annotations: [],
      globalVariables: [],
      launchFields: [],
    })
  })

  it('drops malformed editor annotations before they reach custom node rendering', () => {
    const graph = JSON.stringify({
      nodes: [node],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      annotations: [
        {
          id: 'annotation-1',
          type: 'annotation',
          position: { x: 0, y: 0 },
          data: { text: 'unsafe theme', theme: 'unknown' },
        },
      ],
    })

    expect(parseWorkflowGraph(graph).annotations).toEqual([])
  })

  it('drops nodes and edges that carry no usable identity or geometry', () => {
    const graph = JSON.stringify({
      nodes: [
        node,
        { id: '', position: { x: 0, y: 0 }, data: { kind: 'agent' } },
        { id: 'no-position', data: { kind: 'agent' } },
        { id: 'bad-position', position: { x: 'nope', y: 0 }, data: { kind: 'agent' } },
      ],
      edges: [edge, { id: '', source: 'start', target: 'agent-1' }],
      viewport: { x: 0, y: 0, zoom: 1 },
    })

    const parsed = parseWorkflowGraph(graph)

    expect(parsed.nodes.map((item) => item.id)).toEqual(['start'])
    expect(parsed.edges.map((item) => item.id)).toEqual(['e1'])
  })

  it('falls back to defaults for invalid JSON and non-object envelopes', () => {
    expect(parseWorkflowGraph('not json')).toEqual(EMPTY_ENVELOPE)
    expect(parseWorkflowGraph('[1,2]')).toEqual(EMPTY_ENVELOPE)
  })

  it('preserves unknown fields through the round-trip', () => {
    const graph = JSON.stringify({
      nodes: [node],
      edges: [edge],
      viewport: { x: 0, y: 0, zoom: 1 },
      customMetadata: { owner: 'rhythm' },
    })

    expect(parseWorkflowGraph(graph)).toMatchObject({
      customMetadata: { owner: 'rhythm' },
    })
  })

  it('upgrades legacy prompt and model nodes to the agent kind on parse', () => {
    const graph = JSON.stringify({
      nodes: [
        { ...node, data: { kind: 'prompt', title: '理解改动', description: 'LLM 推理' } },
        { ...node, data: { kind: 'model', title: '总结', description: 'LLM 推理' } },
      ],
      edges: [edge],
      viewport: { x: 0, y: 0, zoom: 1 },
    })

    expect(parseWorkflowGraph(graph).nodes.map((item) => item.data)).toEqual([
      expect.objectContaining({ kind: 'agent', title: '理解改动' }),
      expect.objectContaining({ kind: 'agent', title: '总结' }),
    ])
  })

  it('writes schema v2 and preserves executable Loop container metadata', () => {
    const loop: WorkflowDefinitionNode = {
      id: 'loop-1',
      type: 'workflow',
      position: { x: 200, y: 0 },
      data: {
        kind: 'loop',
        title: 'Refine',
        description: '',
        loopConfig: {
          maxIterations: 3,
          variables: [
            {
              name: 'draft',
              valueType: 'string',
              initial: { kind: 'constant', value: 'seed' },
              feedback: ['refine-agent', 'output'],
            },
          ],
          until: {
            logic: 'and',
            conditions: [{ variableSelector: ['refine-agent', 'output'], operator: 'not_empty' }],
          },
          outputs: [{ name: 'result', variableSelector: ['refine-agent', 'output'] }],
        },
      },
    }
    const child: WorkflowDefinitionNode = {
      id: 'refine-agent',
      type: 'workflow',
      parentId: loop.id,
      position: { x: 80, y: 100 },
      data: {
        kind: 'agent',
        title: 'Refine draft',
        description: '',
        containerId: loop.id,
      },
    }
    const input = {
      nodes: [node, loop, child],
      edges: [edge],
      viewport: { x: 0, y: 0, zoom: 1 },
      annotations: [],
      globalVariables: [],
      launchFields: [],
    }

    const graph = serializeWorkflowGraph(input)

    expect(JSON.parse(graph)).toHaveProperty('schemaVersion', 2)
    expect(parseWorkflowGraph(graph)).toEqual({ schemaVersion: 2, ...input })
  })

  it('loads legacy iteration geometry without dimensions and preserves its entry handle', () => {
    const graph = JSON.stringify({
      nodes: [
        {
          id: 'iter',
          type: 'workflow',
          position: { x: 40, y: 80 },
          data: { kind: 'iteration', title: 'Iteration', description: '' },
        },
        {
          id: 'agent',
          type: 'workflow',
          parentId: 'iter',
          position: { x: 96, y: 160 },
          data: { kind: 'agent', title: 'Agent', description: '' },
        },
      ],
      edges: [{ id: 'entry', source: 'iter', sourceHandle: 'iteration-entry', target: 'agent' }],
      viewport: { x: 0, y: 0, zoom: 1 },
    })

    const parsed = parseWorkflowGraph(graph)

    expect(parsed.nodes.at(0)).not.toHaveProperty('initialWidth')
    expect(parsed.nodes.at(0)).not.toHaveProperty('initialHeight')
    expect(parsed.nodes.at(1)?.parentId).toBe('iter')
    expect(parsed.edges.at(0)?.sourceHandle).toBe('iteration-entry')
  })
})

describe('workflow timestamp projection', () => {
  it('converts epoch millis to an ISO string', () => {
    expect(workflowTimestampToIso(0)).toBe('1970-01-01T00:00:00.000Z')
  })

  it('round-trips an ISO string through the epoch-millis projection', () => {
    const iso = '2026-08-05T08:00:00.000Z'
    expect(workflowTimestampToIso(isoToWorkflowTimestamp(iso))).toBe(iso)
  })
})

// Saved drafts, published snapshots, and exported graphs share this envelope codec.
it('preserves canonical MCP IDs and disabled bindings across graph round trips', () => {
  const agent: WorkflowDefinitionNode = {
    id: 'agent-1',
    type: 'workflow',
    position: { x: 0, y: 0 },
    data: {
      kind: 'agent',
      title: 'Agent',
      description: '',
      agentConfig: {
        schemaVersion: 3,
        executor: { agentCli: 'official/agent', modelId: 'model' },
        roleId: '',
        skills: [],
        prompt: '',
        mcps: [
          { mcpId: 'official/tools', enabled: true },
          { mcpId: 'local/tools', enabled: false },
        ],
      },
    },
  }
  const input = {
    nodes: [agent],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    annotations: [],
    globalVariables: [],
    launchFields: [],
  }
  expect(parseWorkflowGraph(serializeWorkflowGraph(input))).toEqual(input)
})
