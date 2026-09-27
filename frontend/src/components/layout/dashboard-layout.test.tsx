import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { RequireSession } from '@/features/auth/require-session'
import { installCloudSpaceHandlers, installSignedInSession } from '@/test/cloud-handlers'
import { renderRoutes } from '@/test/render'
import { server } from '@/test/msw-server'
import { DashboardLayout } from './dashboard-layout'

function renderRouter(initialPath: string) {
  return renderRoutes(
    [
      { path: '/login', element: <div>Login screen</div> },
      { path: '/onboarding', element: <div>Onboarding screen</div> },
      {
        path: '/w/:workspaceSlug',
        element: (
          <RequireSession>
            <DashboardLayout />
          </RequireSession>
        ),
        children: [{ path: 'issues', element: <div>Issues screen</div> }],
      },
    ],
    initialPath,
  )
}

describe('DashboardLayout', () => {
  it('redirects to /login with returnTo when there is no session', async () => {
    renderRouter('/w/cloud-dev/issues')
    expect(await screen.findByText('Login screen')).toBeInTheDocument()
  })

  it('renders the matched child route for a joined space', async () => {
    installCloudSpaceHandlers('member')
    renderRouter('/w/cloud-dev/issues')
    expect(await screen.findByText('Issues screen')).toBeInTheDocument()
  })

  it('redirects an unknown slug to the first joined space', async () => {
    installCloudSpaceHandlers('member')
    renderRouter('/w/some-other-workspace/issues')
    expect(await screen.findByText('Issues screen')).toBeInTheDocument()
  })

  it('sends a member with no tenant to onboarding instead of showing demo data', async () => {
    installSignedInSession()
    server.use(
      http.get('/api/v1/me/spaces', () => HttpResponse.json({ items: [], nextCursor: '' })),
    )
    renderRouter('/w/default/issues')
    expect(await screen.findByText('Onboarding screen')).toBeInTheDocument()
    expect(screen.queryByText('Issues screen')).not.toBeInTheDocument()
  })

  it('sends a member whose joined-space list is empty to onboarding', async () => {
    installSignedInSession()
    server.use(
      http.get('/api/v1/me/spaces', () => HttpResponse.json({ items: [], nextCursor: '' })),
    )
    renderRouter('/w/default/issues')
    expect(await screen.findByText('Onboarding screen')).toBeInTheDocument()
  })
})
