import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { useLocation } from 'react-router-dom'
import type { WorkflowRun, WorkflowSnapshot } from '@/api/generated.schemas'
import { WorkflowRunTools } from '@/features/workflows/editor/workflow-run-tools'
import { TEST_TENANT_ID, installCloudSpaceHandlers } from '@/test/cloud-handlers'
import { server } from '@/test/msw-server'
import { renderWithProviders } from '@/test/render'

const WORKFLOW_ID = '44444444-4444-4444-4444-444444444444'
// The tools navigate with the tenant id as the workspace slug segment, exactly
// as `workspacePaths(tenantId)` builds it everywhere else.
const BASE = `/w/${TEST_TENANT_ID}/workflows/${WORKFLOW_ID}`

/** A published snapshot the run button needs to arm. */
function snapshotFixture(id: string, version: number): WorkflowSnapshot {
  return {
    id,
    tenantId: TEST_TENANT_ID,
    workflowId: WORKFLOW_ID,
    name: `版本 ${version}`,
    version,
    graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    createdAt: '2026-09-20T10:00:00+08:00',
  }
}

/** A stored run row the history list and the create response share. */
function runFixture(id: string, name: string): WorkflowRun {
  return {
    id,
    tenantId: TEST_TENANT_ID,
    workflowId: WORKFLOW_ID,
    snapshotId: 'snap-1',
    name,
    workflowName: '安全审查',
    status: 'succeeded',
    input: {},
    nodeStates: {},
    rounds: [],
    error: '',
    definitionSnapshot: null,
    startedAt: '2026-09-20T02:00:00.000Z',
    finishedAt: '2026-09-20T02:00:10.000Z',
    createdAt: '2026-09-20T10:00:00+08:00',
    updatedAt: '2026-09-20T10:00:10+08:00',
  }
}

interface RunToolsOptions {
  snapshots?: WorkflowSnapshot[]
  runs?: WorkflowRun[]
  onCreate?: (body: unknown) => void
}

/** Installs the run endpoints and mounts the tools behind a location probe. */
function renderRunTools({
  snapshots = [snapshotFixture('snap-1', 1)],
  runs = [],
  onCreate = () => {},
}: RunToolsOptions = {}) {
  installCloudSpaceHandlers('admin')
  const created: WorkflowRun = runFixture('run-new', '巡检运行')
  server.use(
    http.get(`/api/v1/tenants/${TEST_TENANT_ID}/workflows/${WORKFLOW_ID}/snapshots`, () =>
      HttpResponse.json({ items: snapshots, nextCursor: '' }),
    ),
    http.get(`/api/v1/tenants/${TEST_TENANT_ID}/workflows/${WORKFLOW_ID}/runs`, () =>
      HttpResponse.json({ items: runs, nextCursor: '' }),
    ),
    http.post(
      `/api/v1/tenants/${TEST_TENANT_ID}/workflows/${WORKFLOW_ID}/runs`,
      async ({ request }) => {
        onCreate(await request.json())
        return HttpResponse.json({ resource: created })
      },
    ),
  )
  const locationSpy = vi.fn<(pathname: string) => void>()
  function Probe() {
    const location = useLocation()
    locationSpy(location.pathname)
    return null
  }
  renderWithProviders(
    <>
      <WorkflowRunTools tenantId={TEST_TENANT_ID} workflowId={WORKFLOW_ID} />
      <Probe />
    </>,
    { route: BASE, slug: TEST_TENANT_ID },
  )
  return locationSpy
}

describe('WorkflowRunTools', () => {
  it('disables the run button while no snapshot exists to execute', async () => {
    renderRunTools({ snapshots: [] })

    const runButton = await screen.findByRole('button', { name: '运行' })
    // The button starts disabled only once the empty snapshot list resolves;
    // until then there is no answer either way.
    await waitFor(() => expect(runButton).toBeDisabled())
    expect(runButton).toHaveAttribute('title', '请先发布一个版本，才能运行这个工作流')
  })

  it('arms the run button once a snapshot exists, creating the run and navigating to it', async () => {
    const bodies: unknown[] = []
    const locationSpy = renderRunTools({ runs: [], onCreate: (body) => bodies.push(body) })
    const runButton = await screen.findByRole('button', { name: '运行' })
    await waitFor(() => expect(runButton).toBeEnabled())

    fireEvent.click(runButton)

    await waitFor(() => expect(locationSpy).toHaveBeenCalledWith(`${BASE}/runs/run-new`))
    expect(bodies).toEqual([{}])
  })

  it('lists run history and opens a run from a row', async () => {
    const locationSpy = renderRunTools({
      runs: [runFixture('run-1', '巡检运行'), runFixture('run-2', '发布检查')],
    })

    fireEvent.click(await screen.findByRole('button', { name: '运行历史' }))

    fireEvent.click(await screen.findByRole('button', { name: '打开运行 巡检运行' }))
    expect(locationSpy).toHaveBeenCalledWith(`${BASE}/runs/run-1`)
  })

  it('shows the quiet empty state when nothing has ever run', async () => {
    renderRunTools({ runs: [] })

    fireEvent.click(await screen.findByRole('button', { name: '运行历史' }))

    expect(await screen.findByText('还没有运行记录。')).toBeInTheDocument()
  })
})
