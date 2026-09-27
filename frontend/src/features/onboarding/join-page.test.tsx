import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { JoinContinue, JoinPage } from '@/features/onboarding/join-page'
import { PENDING_JOIN_PATH_KEY } from '@/lib/paths'
import {
  installSignedInSession,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
} from '@/test/cloud-handlers'
import { renderRoutes } from '@/test/render'
import { server } from '@/test/msw-server'

const TOKEN = 'a'.repeat(43)

function renderJoin(kind: 'invite' | 'apply', token = TOKEN) {
  return renderRoutes(
    [
      { path: '/join/invite/:token', element: <JoinPage kind="invite" /> },
      { path: '/join/apply/:token', element: <JoinPage kind="apply" /> },
      { path: '/onboarding', element: <div>Onboarding screen</div> },
      { path: '/w/:workspaceSlug/issues', element: <div>Issues screen</div> },
    ],
    `/join/${kind}/${token}`,
  )
}

function space() {
  return {
    id: TEST_SPACE_ID,
    tenantId: TEST_TENANT_ID,
    name: 'Team',
    slug: 'team',
    role: 'member',
    description: '',
    createdBy: TEST_USER_ID,
    version: 1,
    createdAt: '2026-09-20T10:00:00Z',
    updatedAt: '2026-09-20T10:00:00Z',
    archivedAt: null,
  }
}

describe('JoinPage', () => {
  it('restores a private link after external login from browser tab storage', async () => {
    installSignedInSession()
    sessionStorage.setItem(PENDING_JOIN_PATH_KEY, `/join/invite/${TOKEN}`)
    server.use(
      http.get('/api/v1/me/spaces', () => HttpResponse.json({ items: [], nextCursor: '' })),
    )
    renderRoutes(
      [
        { path: '/join/continue', element: <JoinContinue /> },
        { path: '/join/invite/:token', element: <JoinPage kind="invite" /> },
      ],
      '/join/continue',
    )
    expect(await screen.findByRole('button', { name: '确认加入' })).toBeInTheDocument()
    sessionStorage.removeItem(PENDING_JOIN_PATH_KEY)
  })

  it('returns to onboarding when no private link survived login', async () => {
    sessionStorage.removeItem(PENDING_JOIN_PATH_KEY)
    renderRoutes(
      [
        { path: '/join/continue', element: <JoinContinue /> },
        { path: '/onboarding', element: <div>Onboarding screen</div> },
      ],
      '/join/continue',
    )
    expect(await screen.findByText('Onboarding screen')).toBeInTheDocument()
  })

  it('redeems a single-use invitation and enters the joined tenant', async () => {
    installSignedInSession()
    let joined = false
    let submitted: unknown
    server.use(
      http.get('/api/v1/me/spaces', () =>
        HttpResponse.json({ items: joined ? [space()] : [], nextCursor: '' }),
      ),
      http.post('/api/v1/join/invitations/redeem', async ({ request }) => {
        submitted = await request.json()
        joined = true
        return HttpResponse.json({
          tenantId: TEST_TENANT_ID,
          userId: TEST_USER_ID,
          name: 'Team',
          role: 'member',
          status: 'active',
          version: 1,
        })
      }),
    )
    const user = userEvent.setup()
    renderJoin('invite')
    await user.click(await screen.findByRole('button', { name: '确认加入' }))
    await waitFor(() => expect(submitted).toEqual({ token: TOKEN }))
    await user.click(await screen.findByRole('button', { name: '进入空间' }))
    expect(await screen.findByText('Issues screen')).toBeInTheDocument()
  })

  it('submits an application without granting immediate space access', async () => {
    installSignedInSession()
    server.use(
      http.get('/api/v1/me/spaces', () => HttpResponse.json({ items: [], nextCursor: '' })),
      http.post('/api/v1/join/requests', async () => {
        await delay(50)
        return HttpResponse.json(
          {
            id: 'r',
            tenantId: TEST_TENANT_ID,
            userId: TEST_USER_ID,
            linkId: 'l',
            status: 'pending',
            version: 1,
          },
          { status: 201 },
        )
      }),
    )
    const user = userEvent.setup()
    renderJoin('apply')
    await user.click(await screen.findByRole('button', { name: '提交申请' }))
    expect(screen.getByRole('button', { name: '处理中…' })).toBeDisabled()
    expect(await screen.findByText('申请状态：等待管理员审批')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '进入空间' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '返回空间列表' }))
    expect(await screen.findByText('Onboarding screen')).toBeInTheDocument()
  })

  it('rejects malformed links and reports revoked invitations', async () => {
    installSignedInSession()
    server.use(
      http.get('/api/v1/me/spaces', () => HttpResponse.json({ items: [], nextCursor: '' })),
    )
    renderJoin('invite', 'short')
    expect(await screen.findByText('链接无效')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认加入' })).toBeDisabled()
  })

  it('keeps a revoked invitation visible as an actionable fault', async () => {
    installSignedInSession()
    server.use(
      http.get('/api/v1/me/spaces', () => HttpResponse.json({ items: [], nextCursor: '' })),
      http.post('/api/v1/join/invitations/redeem', () =>
        HttpResponse.json(
          { code: 'join_link_unavailable', params: {}, requestId: 'r' },
          { status: 404 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderJoin('invite')
    await user.click(await screen.findByRole('button', { name: '确认加入' }))
    expect(await screen.findByText('操作失败：join_link_unavailable')).toBeInTheDocument()
  })
})
