import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowImportDialog } from '@/features/workflows/editor/workflow-import-dialog'
import { MAX_WORKFLOW_IMPORT_BYTES } from '@/features/workflows/editor/workflow-transfer'
import { asJsonRecord } from '@/features/workflows/runtime/json-record'
import {
  installCloudSpaceHandlers,
  installWorkflowPublish,
  TEST_TENANT_ID,
  workflowFixture,
} from '@/test/cloud-handlers'
import { server } from '@/test/msw-server'
import { renderWithProviders } from '@/test/render'

/** The persisted form of an Agent contract, as an export would carry it. */
const AGENT_CONFIG = {
  schemaVersion: 3,
  executor: { agentCli: 'official/ora-space.codeagentcli', modelId: 'gpt-5' },
  roleId: 'Architect',
  skills: [],
  mcps: [],
  prompt: '',
}

/** An exported document whose nodes, agents, and variables the preview counts. */
const EXPORT_DOCUMENT = {
  id: 'workflow-exported',
  name: 'Review flow',
  description: 'Reviews a change',
  updatedAt: '2026-09-20T12:00:00+08:00',
  viewport: { x: 0, y: 0, zoom: 1 },
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
      data: { kind: 'agent', title: 'Agent', description: '', agentConfig: AGENT_CONFIG },
    },
  ],
  edges: [{ id: 'e1', type: 'workflow', source: 'start', target: 'agent-1' }],
  annotations: [],
  globalVariables: [{ name: 'site.url', valueType: 'string', value: 'https://example.com' }],
}

const EXPORT_JSON = JSON.stringify(EXPORT_DOCUMENT, null, 2)

/** The id imports are created under by the create mock. */
const CREATED_ID = '77777777-7777-7777-7777-777777777777'

/** Treats a JSON value the mock produced as the object it must be, or fails the test. */
function expectJsonRecord(value: unknown): Record<string, unknown> {
  const record = asJsonRecord(value)
  if (record === undefined) {
    throw new Error('expected the request body to be a JSON object')
  }
  return record
}

/** Installs the create endpoint, feeding `onBody` the request it received. */
function installCreate(onBody: (body: unknown) => void, status = 200): void {
  server.use(
    http.post(`/api/v1/tenants/${TEST_TENANT_ID}/workflows`, async ({ request }) => {
      const body = await request.json()
      onBody(body)
      if (status >= 400) {
        return HttpResponse.json({ code: 'workflow_conflict', message: 'conflict' }, { status })
      }
      const name = asJsonRecord(body)?.['name']
      if (typeof name !== 'string') {
        return HttpResponse.json(
          { code: 'workflow_conflict', message: 'missing name' },
          { status: 400 },
        )
      }
      return HttpResponse.json({ resource: workflowFixture({ id: CREATED_ID, name }) })
    }),
  )
}

/** The snapshot the publish mock answers with; the dialog ignores its body. */
const PUBLISHED_SNAPSHOT = {
  id: 'snap-1',
  tenantId: TEST_TENANT_ID,
  workflowId: CREATED_ID,
  name: '导入版',
  version: 1,
}

/** Installs the publish endpoint against the shared test handler. */
function installPublish(onBody: (body: unknown) => void, status = 200): void {
  installWorkflowPublish(onBody, PUBLISHED_SNAPSHOT, status)
}

/** Picks a file through the drop zone's hidden input and waits for the result stage. */
async function pickFile(text: string = EXPORT_JSON, name = 'flow.reactflow.json'): Promise<void> {
  fireEvent.change(screen.getByLabelText('选择文件'), {
    target: { files: [new File([text], name, { type: 'application/json' })] },
  })
}

/** Picks the default valid file and confirms the import; returns the callback. */
async function submitValidImport(): Promise<(id: string) => void> {
  const onImported = renderImport()
  await pickFile()
  fireEvent.click(await screen.findByRole('button', { name: '导入' }))
  return onImported
}

/** Asserts the common shape of a rejected import: the fault row and no hand-off. */
async function expectRejectedImport(onImported: (id: string) => void): Promise<void> {
  expect(await screen.findByText('已存在同名工作流。')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '导入预览' })).toBeInTheDocument()
  expect(onImported).not.toHaveBeenCalled()
}

/** Mounts the dialog with the given import-completion callback. */
function renderImport(
  onOpenChange: (open: boolean) => void = vi.fn<(open: boolean) => void>(),
): (id: string) => void {
  const onImported = vi.fn<(id: string) => void>()
  renderWithProviders(
    <WorkflowImportDialog
      tenantId={TEST_TENANT_ID}
      open
      onOpenChange={onOpenChange}
      onImported={onImported}
    />,
  )
  return onImported
}

describe('WorkflowImportDialog pick stage', () => {
  beforeEach(() => installCloudSpaceHandlers('admin'))

  it('describes what to pick and offers a way out', () => {
    const onOpenChange = vi.fn<(open: boolean) => void>()
    renderImport(onOpenChange)

    expect(screen.getByRole('heading', { name: '导入工作流' })).toBeInTheDocument()
    expect(
      screen.getByText('选择由工作流导出功能写出的 .reactflow.json 文件。'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('WorkflowImportDialog preview stage', () => {
  beforeEach(() => installCloudSpaceHandlers('admin'))

  it('prefills the workflow name and summarizes the imported content', async () => {
    installCreate(() => {})
    renderImport()
    await pickFile()

    expect(await screen.findByRole('heading', { name: '导入预览' })).toBeInTheDocument()
    expect(screen.getByLabelText('工作流名称')).toHaveValue('Review flow')
    expect(screen.getByText('节点')).toBeInTheDocument()
    expect(screen.getByText('Agent')).toBeInTheDocument()
    expect(screen.getByText('全局变量')).toBeInTheDocument()
    // The counts ride the summary rows; each is a standalone number.
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getAllByText('1')).toHaveLength(2)
  })

  it('creates the workflow from the imported graph and publishes, then hands over the id', async () => {
    const createdBody: unknown[] = []
    const publishBody: unknown[] = []
    installCreate((body) => createdBody.push(body))
    installPublish((body) => publishBody.push(body))
    const onImported = renderImport()
    await pickFile()
    fireEvent.click(await screen.findByRole('button', { name: '导入' }))

    await waitFor(() => expect(onImported).toHaveBeenCalledWith(CREATED_ID))
    const created = expectJsonRecord(createdBody[0])
    expect(created['name']).toBe('Review flow')
    expect(created['description']).toBe('Reviews a change')
    const graph = expectJsonRecord(created['graph'])
    const nodes = graph['nodes']
    if (!Array.isArray(nodes)) {
      throw new Error('expected the created graph to carry a node list')
    }
    expect(nodes).toHaveLength(2)
    expect(graph['globalVariables']).toEqual(EXPORT_DOCUMENT.globalVariables)
    expect(publishBody).toHaveLength(1)
  })

  it('leaves the new workflow unpublished when the checkbox is cleared', async () => {
    const publishBody: unknown[] = []
    installCreate(() => {})
    installPublish((body) => publishBody.push(body))
    const onImported = renderImport()
    await pickFile()
    // The label wraps both the title and the hint, so the checkbox name is a substring.
    fireEvent.click(await screen.findByRole('checkbox', { name: /导入后立即发布/ }))
    fireEvent.click(screen.getByRole('button', { name: '导入' }))

    await waitFor(() => expect(onImported).toHaveBeenCalledWith(CREATED_ID))
    expect(publishBody).toHaveLength(0)
  })

  it('reports a rejected create and stays on the preview', async () => {
    installCreate(() => {}, 409)
    await expectRejectedImport(await submitValidImport())
  })

  it('reports a publish rejection the same way a create one is reported', async () => {
    installCreate(() => {})
    installPublish(() => {}, 409)
    await expectRejectedImport(await submitValidImport())
  })
})

describe('WorkflowImportDialog failure stage', () => {
  beforeEach(() => installCloudSpaceHandlers('admin'))

  it('explains a file that is not JSON without creating anything', async () => {
    const onImported = renderImport()
    await pickFile('not json{', 'bad.reactflow.json')

    expect(await screen.findByRole('heading', { name: '无法导入' })).toBeInTheDocument()
    expect(screen.getByText('这不是有效的 JSON')).toBeInTheDocument()
    expect(screen.getByText('文件不是 JSON，或不是由工作流导出功能写出的。')).toBeInTheDocument()
    expect(screen.getByText('选择其他文件')).toBeInTheDocument()
    expect(onImported).not.toHaveBeenCalled()
  })

  it('lists what is wrong with a JSON value that is not a workflow document', async () => {
    renderImport()
    await pickFile('{"hello": 1}', 'hello.reactflow.json')

    expect(await screen.findByRole('heading', { name: '无法导入' })).toBeInTheDocument()
    expect(screen.getByText('这不是可导入的工作流文档')).toBeInTheDocument()
    expect(screen.getByText(/document must carry an id/)).toBeInTheDocument()
  })

  it('refuses an oversized file', async () => {
    renderImport()
    const file = new File(['tiny'], 'huge.reactflow.json', { type: 'application/json' })
    Object.defineProperty(file, 'size', { value: MAX_WORKFLOW_IMPORT_BYTES + 1 })
    fireEvent.change(screen.getByLabelText('选择文件'), { target: { files: [file] } })

    expect(await screen.findByRole('heading', { name: '无法导入' })).toBeInTheDocument()
    expect(screen.getByText('文件超过大小上限')).toBeInTheDocument()
  })

  it('offers another file after a rejection', async () => {
    installCreate(() => {})
    renderImport()
    await pickFile('not json{', 'first.reactflow.json')
    await screen.findByRole('heading', { name: '无法导入' })
    fireEvent.click(screen.getByRole('button', { name: '选择其他文件' }))
    await screen.findByRole('heading', { name: '导入工作流' })

    await pickFile(EXPORT_JSON, 'flow.reactflow.json')
    expect(await screen.findByRole('heading', { name: '导入预览' })).toBeInTheDocument()
  })
})
