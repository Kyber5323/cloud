import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowSnapshot } from '@/api/generated.schemas'
import { WorkflowExportDialog } from '@/features/workflows/editor/workflow-export-dialog'
import { installCloudSpaceHandlers, TEST_TENANT_ID, workflowFixture } from '@/test/cloud-handlers'
import { server } from '@/test/msw-server'
import { renderWithProviders } from '@/test/render'

/** The live draft an export starts from: one Start node plus one workflow variable. */
const DRAFT_GRAPH: Record<string, unknown> = {
  nodes: [
    {
      id: 'start',
      type: 'workflow',
      position: { x: 0, y: 0 },
      deletable: false,
      data: { kind: 'start', title: '开始', description: '' },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  annotations: [],
  globalVariables: [{ name: 'site.url', valueType: 'string', value: '' }],
}

/** A frozen published version, carrying an Agent only the snapshot knows. */
const SNAPSHOT_GRAPH = {
  nodes: [
    {
      id: 'agent-9',
      type: 'workflow',
      position: { x: 240, y: 0 },
      data: {
        kind: 'agent',
        title: '快照 Agent',
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
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  annotations: [],
  globalVariables: [],
}

/** A published snapshot as the backend stores it. */
function snapshotFixture(version: number, name = `版本 ${version}`): WorkflowSnapshot {
  return {
    id: `snap-${version}`,
    tenantId: TEST_TENANT_ID,
    workflowId: '44444444-4444-4444-4444-444444444444',
    name,
    version,
    graph: { ...SNAPSHOT_GRAPH },
    createdAt: '2026-09-20T10:00:00+08:00',
  }
}

const SNAPSHOTS = [snapshotFixture(3, '第三版')]

// The export writes its file with the browser download primitives jsdom lacks:
// a blob URL and a programmatic anchor click. Everything else in the dialog is
// pure state, so only these two globals are stubbed for the whole file.
const createObjectURL = vi.fn<(blob: Blob) => string>()
const revokeObjectURL = vi.fn<() => void>()
const anchorClick = vi.fn<() => void>()

beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
  Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
    configurable: true,
    value: anchorClick,
  })
})

beforeEach(() => {
  installCloudSpaceHandlers('admin')
  createObjectURL.mockClear().mockReturnValue('blob:mock')
  revokeObjectURL.mockClear()
  anchorClick.mockClear()
  server.use(
    http.get(`/api/v1/tenants/${TEST_TENANT_ID}/workflows/:wfid/snapshots`, () =>
      HttpResponse.json({ items: SNAPSHOTS, nextCursor: '' }),
    ),
  )
})

/** Mounts the dialog always open, with the given close callback. */
function renderExport(onOpenChange: (open: boolean) => void): void {
  renderWithProviders(
    <WorkflowExportDialog
      tenantId={TEST_TENANT_ID}
      workflow={workflowFixture({ name: '安全审查', description: '平时用' })}
      draftGraph={() => DRAFT_GRAPH}
      open
      onOpenChange={onOpenChange}
    />,
  )
}

/** Opens the collapsible preview so its JSON text is readable. */
function openPreview(): void {
  fireEvent.click(screen.getByText('预览文件结构'))
}

describe('WorkflowExportDialog', () => {
  it('exports the live draft by default under the workflow name', async () => {
    renderExport(vi.fn<(open: boolean) => void>())

    expect(screen.getByRole('heading', { name: '导出 安全审查' })).toBeInTheDocument()
    // The radio's accessible name carries its detail line, so matching is a substring.
    expect(screen.getByRole('radio', { name: /当前草稿/ })).toBeChecked()
    expect(screen.getByLabelText('文件名')).toHaveValue('安全审查.reactflow.json')

    openPreview()
    expect(screen.getByText(/site\.url/)).toBeInTheDocument()
  })

  it('switches to a published version, previewing it and versioning the file name', async () => {
    renderExport(vi.fn<(open: boolean) => void>())
    fireEvent.click(await screen.findByRole('radio', { name: /已发布版本 3/ }))

    const fileName = screen.getByLabelText('文件名')
    await waitFor(() => expect(fileName).toHaveValue('安全审查.v3.reactflow.json'))
    // The preview now shows the snapshot graph, and the draft's variable is gone.
    openPreview()
    expect(await screen.findByText(/agent-9/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/site\.url/)).not.toBeInTheDocument())
  })

  it('downloads the document as a file and closes on confirm', async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>()
    renderExport(onOpenChange)

    fireEvent.click(screen.getByRole('button', { name: '导出' }))

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled())
    const blob = createObjectURL.mock.calls[0]?.[0]
    if (blob === undefined) {
      throw new Error('expected the export to offer a file for download')
    }
    expect(blob).toBeInstanceOf(Blob)
    expect(await blob.text()).toContain('安全审查')
    expect(anchorClick).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('refuses an empty file name', () => {
    renderExport(vi.fn<(open: boolean) => void>())

    fireEvent.change(screen.getByLabelText('文件名'), { target: { value: '   ' } })

    expect(screen.getByRole('button', { name: '导出' })).toBeDisabled()
  })

  it('closing without confirming downloads nothing', () => {
    const onOpenChange = vi.fn<(open: boolean) => void>()
    renderExport(onOpenChange)

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})
