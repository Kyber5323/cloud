import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { WorkflowsPage } from '@/features/workflows/workflows-page'
import {
  installCloudSpaceHandlers,
  installWorkflowHandlers,
  TEST_TENANT_ID,
  workflowFixture,
} from '@/test/cloud-handlers'
import { renderAtRoute } from '@/test/render'

/**
 * Mounts the list for the tenant `CloudScope` would resolve in the app, behind
 * a real route match so `useParams` supplies the workspace slug used for links.
 */
function renderList() {
  installCloudSpaceHandlers('admin')
  return renderAtRoute(
    '/w/:workspaceSlug/workflows',
    <WorkflowsPage slug={TEST_TENANT_ID} />,
    '/w/cloud-dev/workflows',
  )
}

describe('WorkflowsPage', () => {
  it('lists the tenant workflows with their node counts', async () => {
    installWorkflowHandlers([
      workflowFixture({
        name: '安全审查',
        graph: {
          nodes: [
            { id: 'start', position: { x: 0, y: 0 }, data: { kind: 'start' } },
            { id: 'output', position: { x: 200, y: 0 }, data: { kind: 'output' } },
          ],
          edges: [],
        },
      }),
      workflowFixture({ id: '55555555-5555-5555-5555-555555555555', name: '发布流程' }),
    ])
    renderList()

    expect(await screen.findByText('安全审查')).toBeInTheDocument()
    expect(screen.getByText('发布流程')).toBeInTheDocument()
    // The node count is read out of the stored graph document, not a column.
    expect(screen.getByText('2 个节点')).toBeInTheDocument()
  })

  it('shows the empty state rather than an empty list', async () => {
    installWorkflowHandlers([])
    renderList()

    expect(await screen.findByText('还没有工作流')).toBeInTheDocument()
  })

  it('filters rows and reports a search that matches nothing', async () => {
    installWorkflowHandlers([
      workflowFixture({ name: '安全审查' }),
      workflowFixture({ id: '55555555-5555-5555-5555-555555555555', name: '发布流程' }),
    ])
    const user = userEvent.setup()
    renderList()
    await screen.findByText('安全审查')

    await user.type(screen.getByLabelText('搜索工作流'), '发布')

    await waitFor(() => {
      expect(screen.queryByText('安全审查')).not.toBeInTheDocument()
    })
    expect(screen.getByText('发布流程')).toBeInTheDocument()

    await user.type(screen.getByLabelText('搜索工作流'), 'zzz')
    expect(await screen.findByText('没有匹配的工作流')).toBeInTheDocument()
  })
})
