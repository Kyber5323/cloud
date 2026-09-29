import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { GeneralSettingsPage } from '@/features/settings/general-settings-page'
import { SettingsLayout } from '@/features/settings/settings-layout'
import { CurrentSpaceProvider } from '@/features/spaces/current-space'
import { installCloudSpaceHandlers, TEST_SPACE_ID, TEST_TENANT_ID } from '@/test/cloud-handlers'
import { renderRoutes } from '@/test/render'
import { server } from '@/test/msw-server'

function renderSettingsPage() {
  return renderRoutes(
    [
      {
        path: '/w/:workspaceSlug/settings',
        element: (
          <CurrentSpaceProvider slug="cloud-dev">
            <SettingsLayout slug="cloud-dev" />
          </CurrentSpaceProvider>
        ),
        children: [{ index: true, element: <GeneralSettingsPage /> }],
      },
    ],
    '/w/cloud-dev/settings',
  )
}

describe('GeneralSettingsPage', () => {
  it('lets an administrator rename the sole tenant space', async () => {
    installCloudSpaceHandlers('admin')
    let changed = false
    server.use(
      http.patch(`/api/v1/tenants/${TEST_TENANT_ID}/spaces/${TEST_SPACE_ID}`, () => {
        changed = true
        return HttpResponse.json({
          id: TEST_SPACE_ID,
          tenantId: TEST_TENANT_ID,
          name: 'Cloud Dev',
          slug: 'cloud-dev',
          description: '',
          createdBy: 'u1',
          version: 2,
          createdAt: '2026-09-20T10:00:00+08:00',
          updatedAt: '2026-09-20T10:00:00+08:00',
          archivedAt: null,
        })
      }),
    )
    renderSettingsPage()
    const user = userEvent.setup()

    const name = await screen.findByLabelText('工作区名称')
    await user.clear(name)
    await user.type(name, 'Renamed')
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(changed).toBe(true))
  })

  it('prevents non-admins from renaming the tenant', async () => {
    installCloudSpaceHandlers('member')
    renderSettingsPage()

    expect(
      await screen.findByLabelText('工作区名称', undefined, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('工作区名称')).toBeDisabled()
  })
})
