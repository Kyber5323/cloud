import { screen } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { Workflow } from '@/api/generated.schemas'
import { WorkflowEditorPage } from '@/features/workflows/workflow-editor-page'
import {
  installCloudSpaceHandlers,
  installWorkflowHandlers,
  TEST_TENANT_ID,
  workflowFixture,
} from '@/test/cloud-handlers'
import { server } from '@/test/msw-server'
import { renderAtRoute } from '@/test/render'

/** An id no fixture answers for, so the detail route resolves to nothing. */
const MISSING_ID = '99999999-9999-9999-9999-999999999999'

/**
 * Mounts the editor page behind a real route match, so `useParams` supplies the
 * workspace slug the page builds its breadcrumb from — the same way the app
 * reaches it.
 */
function renderPage(workflowId: string) {
  installCloudSpaceHandlers('admin')
  return renderAtRoute(
    '/w/:workspaceSlug/workflows/:workflowId',
    <WorkflowEditorPage slug={TEST_TENANT_ID} />,
    `/w/cloud-dev/workflows/${workflowId}`,
  )
}

/** The card React Flow drew for one stored node. */
function nodeCard(id: string): HTMLElement {
  const card = document.querySelector(`[data-workflow-node-id="${id}"]`)
  if (!(card instanceof HTMLElement)) {
    throw new Error(`the canvas did not draw a card for "${id}"`)
  }
  return card
}

describe('WorkflowEditorPage', () => {
  it('holds the frame with a placeholder while the workflow loads', async () => {
    installWorkflowHandlers([workflowFixture()])
    server.use(
      http.get(`/api/v1/tenants/${TEST_TENANT_ID}/workflows/:wfid`, async () => {
        await delay('infinite')
        return HttpResponse.json(workflowFixture())
      }),
    )
    renderPage(workflowFixture().id)

    // The header is drawn from the route, not from the record, so it is up
    // before the response is.
    expect(screen.getByRole('heading', { name: '工作流' })).toBeInTheDocument()
    expect(document.querySelector('[data-slot="skeleton"]')).toBeInTheDocument()
    expect(screen.queryByRole('toolbar', { name: '添加工作流节点' })).not.toBeInTheDocument()
  })

  it('says the workflow is gone rather than drawing an empty canvas', async () => {
    installWorkflowHandlers([workflowFixture()])
    renderPage(MISSING_ID)

    expect(await screen.findByText('未找到该工作流。')).toBeInTheDocument()
    expect(screen.queryByRole('toolbar', { name: '添加工作流节点' })).not.toBeInTheDocument()
  })

  it('opens the loaded workflow in the editor, under its own name', async () => {
    const workflow: Workflow = workflowFixture({
      graph: {
        nodes: [
          {
            id: 'start-1',
            type: 'workflow',
            position: { x: 0, y: 0 },
            data: { kind: 'start', title: '开始 1', description: '定义输入', input: '' },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    })
    installWorkflowHandlers([workflow])
    renderPage(workflow.id)

    expect(await screen.findByRole('heading', { name: '安全审查' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '工作流' })).toHaveAttribute(
      'href',
      '/w/cloud-dev/workflows',
    )
    expect(screen.getByRole('toolbar', { name: '添加工作流节点' })).toBeInTheDocument()
    expect(screen.getByText(/1 个节点/)).toBeInTheDocument()
    expect(nodeCard('start-1')).toBeInTheDocument()
  })
})
