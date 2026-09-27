import { describe, expect, it } from 'vitest'
import type { Workflow as CloudWorkflow } from '@/api/generated.schemas'
import { workflowFixture } from '@/test/cloud-handlers'
import {
  MAX_WORKFLOW_IMPORT_BYTES,
  formatWorkflowFileSize,
  jsonErrorLocation,
  parseWorkflowImportFile,
  readWorkflowImportFile,
  summarizeWorkflowTransfer,
  workflowExportDocument,
  workflowExportFileName,
} from '@/features/workflows/editor/workflow-transfer'

/** One published-version graph the export preview can switch to. */
const SNAPSHOT_GRAPH = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }

/** A minimal fresh graph the draft export starts from. */
const DRAFT_GRAPH = {
  nodes: [
    {
      id: 'start',
      type: 'workflow',
      position: { x: 0, y: 0 },
      deletable: false,
      data: { kind: 'start', title: '开始', description: '' },
    },
    {
      id: 'agent-1',
      type: 'workflow',
      position: { x: 240, y: 0 },
      data: {
        kind: 'agent',
        title: 'Agent',
        description: '',
        agentConfig: {
          schemaVersion: 3,
          executor: { agentCli: 'official/ora-space.codeagentcli', modelId: 'gpt-5' },
          roleId: 'Architect',
          skills: [],
          mcps: [],
          prompt: '',
        },
      },
    },
  ],
  edges: [{ id: 'e1', type: 'workflow', source: 'start', target: 'agent-1' }],
  viewport: { x: 0, y: 0, zoom: 1 },
  annotations: [],
  globalVariables: [{ name: 'site.url', valueType: 'string', value: 'https://example.com' }],
}

/** The envelope written by an export, round-trippable through the importer. */
const EXPORT_DOCUMENT = {
  id: 'workflow-exported',
  name: 'Review flow',
  description: 'Reviews a change',
  updatedAt: '2026-09-20T12:00:00+08:00',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: DRAFT_GRAPH.nodes,
  edges: DRAFT_GRAPH.edges,
  annotations: DRAFT_GRAPH.annotations,
  globalVariables: DRAFT_GRAPH.globalVariables,
}

describe('jsonErrorLocation', () => {
  it('maps a V8 position to a 1-based line and column', () => {
    const location = jsonErrorLocation(
      '{"a": 1}',
      new Error('Unexpected token } in JSON at position 6'),
    )

    expect(location).toEqual({
      line: 1,
      column: 7,
      excerpt: [{ number: 1, text: '{"a": 1}' }],
    })
  })

  it('carves out the line around the fault for the excerpt', () => {
    const text = 'one\ntwo\nthree\nfour\nfive'
    // Position 8 is the `t` that starts "three": one(0) \n(3) two(4) \n(7).
    const location = jsonErrorLocation(text, new Error('boom at position 8'))

    expect(location?.line).toBe(3)
    expect(location?.column).toBe(1)
    expect(location?.excerpt.map((line) => [line.number, line.text])).toEqual([
      [2, 'two'],
      [3, 'three'],
      [4, 'four'],
    ])
  })

  it('strips a Windows line ending from an excerpt line', () => {
    const location = jsonErrorLocation('ab\r\ncd', new Error('boom at position 2'))

    expect(location?.excerpt.map((line) => line.text)).toEqual(['ab', 'cd'])
  })

  it('returns null when the error carries no position', () => {
    expect(jsonErrorLocation('{}', new Error('boom'))).toBeNull()
  })

  it('clamps a reported position beyond the text end', () => {
    const location = jsonErrorLocation('ab', new Error('boom at position 99'))

    expect(location?.line).toBe(1)
    expect(location?.column).toBe(3)
  })
})

describe('parseWorkflowImportFile', () => {
  it('turns an exported envelope back into an importable workflow', () => {
    const result = parseWorkflowImportFile(JSON.stringify(EXPORT_DOCUMENT))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.definition.name).toBe('Review flow')
    expect(result.document.definition.nodes.map((node) => node.id)).toEqual(['start', 'agent-1'])
    expect(result.document.definition.globalVariables).toEqual(DRAFT_GRAPH.globalVariables)
  })

  it('reports a file that is not JSON', () => {
    const result = parseWorkflowImportFile('not json{')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.reason).toBe('invalidJson')
  })

  it('reports a JSON value that is not a workflow document', () => {
    const result = parseWorkflowImportFile('{"hello": 1}')

    expect(result.ok).toBe(false)
    if (result.ok) return
    if (result.failure.reason !== 'invalidWorkflow') {
      throw new Error('expected the file to be refused as an invalid workflow')
    }
    expect(result.failure.issues.length).toBeGreaterThan(0)
  })
})

describe('readWorkflowImportFile', () => {
  it('reads and parses a file under the size limit', async () => {
    const result = await readWorkflowImportFile(
      new File([JSON.stringify(EXPORT_DOCUMENT)], 'flow.reactflow.json', {
        type: 'application/json',
      }),
    )

    expect(result.parse.ok).toBe(true)
    expect(result.file.name).toBe('flow.reactflow.json')
  })

  it('refuses an oversized file before its text is read', async () => {
    const file = new File(['tiny'], 'huge.reactflow.json', { type: 'application/json' })
    Object.defineProperty(file, 'size', { value: MAX_WORKFLOW_IMPORT_BYTES + 1 })

    const result = await readWorkflowImportFile(file)

    expect(result.parse.ok).toBe(false)
    if (result.parse.ok) return
    expect(result.parse.failure.reason).toBe('fileTooLarge')
  })
})

describe('summarizeWorkflowTransfer', () => {
  it('counts nodes, agents, and workflow variables separately', () => {
    const result = parseWorkflowImportFile(JSON.stringify(EXPORT_DOCUMENT))
    if (!result.ok) throw new Error('fixture must import')

    expect(summarizeWorkflowTransfer(result.document)).toEqual({
      nodeCount: 2,
      agentCount: 1,
      globalVariableCount: 1,
    })
  })
})

describe('workflowExportFileName', () => {
  it('appends the portable extension to the workflow name', () => {
    expect(workflowExportFileName('安全审查')).toBe('安全审查.reactflow.json')
  })

  it('embeds the published version so exports never collide on disk', () => {
    expect(workflowExportFileName('安全审查', 3)).toBe('安全审查.v3.reactflow.json')
  })

  it('replaces characters that are unsafe in any file name', () => {
    // Each unsafe character becomes a space; adjacent ones keep their gaps,
    // matching the desktop exporter's sanitizer exactly.
    expect(workflowExportFileName('a/b:c*d?<e>|f"g\\h')).toBe('a b c d  e  f g h.reactflow.json')
  })

  it('falls back to a generic stem for a name that sanitizes to nothing', () => {
    expect(workflowExportFileName('///')).toBe('workflow.reactflow.json')
  })
})

describe('workflowExportDocument', () => {
  const workflow: CloudWorkflow = workflowFixture({ name: '安全审查', description: '平时用' })

  it('leads with the workflow identity, then carries the graph envelope', () => {
    const document = workflowExportDocument(workflow, DRAFT_GRAPH)

    expect(document['id']).toBe(workflow.id)
    expect(document['name']).toBe('安全审查')
    expect(document['updatedAt']).toBe(workflow.updatedAt)
    expect(document['nodes']).toBe(DRAFT_GRAPH.nodes)
    expect(document['globalVariables']).toBe(DRAFT_GRAPH.globalVariables)
  })

  it('prefers the description the graph carries over the record one', () => {
    const graph = { ...DRAFT_GRAPH, description: '图内描述' }
    expect(workflowExportDocument(workflow, graph)['description']).toBe('图内描述')
  })

  it('falls back to the record description when the graph has none', () => {
    expect(workflowExportDocument(workflow, DRAFT_GRAPH)['description']).toBe('平时用')
    expect(workflowExportDocument(workflow, SNAPSHOT_GRAPH)['description']).toBe('平时用')
  })
})

describe('formatWorkflowFileSize', () => {
  it('formats bytes, kilobytes, and megabytes', () => {
    expect(formatWorkflowFileSize(512)).toBe('512 B')
    expect(formatWorkflowFileSize(2048)).toBe('2.0 KB')
    expect(formatWorkflowFileSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
