import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MembersPage } from '@/features/members/members-page'
import { installCloudSpaceHandlers, TEST_TENANT_ID } from '@/test/cloud-handlers'
import { renderWithProviders } from '@/test/render'
import { server } from '@/test/msw-server'

const ALICE_ID = '33333333-3333-3333-3333-333333333333'
const BOB_ID = '44444444-4444-4444-4444-444444444444'

function row(userId: string, displayName: string, role: string) {
  return {
    id: userId,
    userId,
    tenantId: TEST_TENANT_ID,
    displayName,
    role,
    status: 'active',
    version: 1,
  }
}

function roster(items: unknown[]) {
  server.use(
    http.get(`/api/v1/tenants/${TEST_TENANT_ID}/members`, () =>
      HttpResponse.json({ items, nextCursor: '' }),
    ),
    http.get(`/api/v1/tenants/${TEST_TENANT_ID}/invitations`, () =>
      HttpResponse.json({ items: [], nextCursor: '' }),
    ),
    http.get(`/api/v1/tenants/${TEST_TENANT_ID}/join-links`, () =>
      HttpResponse.json({ items: [], nextCursor: '' }),
    ),
    http.get(`/api/v1/tenants/${TEST_TENANT_ID}/join-requests`, () =>
      HttpResponse.json({ items: [], nextCursor: '' }),
    ),
  )
}

describe('MembersPage', () => {
  it('shows members from later roster pages', async () => {
    installCloudSpaceHandlers('member')
    roster([])
    server.use(
      http.get(`/api/v1/tenants/${TEST_TENANT_ID}/members`, ({ request }) => {
        const after = new URL(request.url).searchParams.get('after')
        if (!after)
          return HttpResponse.json({
            items: [row(ALICE_ID, 'Alice', 'admin')],
            nextCursor: ALICE_ID,
          })
        return HttpResponse.json({ items: [row(BOB_ID, 'Bob', 'member')], nextCursor: '' })
      }),
    )

    renderWithProviders(<MembersPage slug="cloud-dev" />, { slug: 'cloud-dev' })
    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(await screen.findByText('Bob')).toBeInTheDocument()
  })

  it('reads the tenant roster and hides management from ordinary members', async () => {
    installCloudSpaceHandlers('member')
    roster([row(ALICE_ID, 'Alice', 'admin'), row(BOB_ID, 'Bob', 'member')])
    renderWithProviders(<MembersPage slug="cloud-dev" />, { slug: 'cloud-dev' })
    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '移除' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '生成邀请链接' })).not.toBeInTheDocument()
  })

  it('lets an administrator disable a membership through the tenant API', async () => {
    installCloudSpaceHandlers('admin')
    roster([row(ALICE_ID, 'Alice', 'admin'), row(BOB_ID, 'Bob', 'member')])
    let body: unknown
    server.use(
      http.put(`/api/v1/tenants/${TEST_TENANT_ID}/members/${BOB_ID}`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({
          ...row(BOB_ID, 'Bob', 'member'),
          status: 'disabled',
          version: 2,
        })
      }),
    )
    renderWithProviders(<MembersPage slug="cloud-dev" />, { slug: 'cloud-dev' })
    const user = userEvent.setup()
    await screen.findByText('Bob')
    const removeButtons = screen.getAllByRole('button', { name: '移除' })
    if (!removeButtons[1]) throw new Error('expected Bob row')
    await user.click(removeButtons[1])
    await waitFor(() => expect(body).toEqual({ role: 'member', status: 'disabled', version: 1 }))
  })

  it('does not reactivate a removed member without a fresh joining check', async () => {
    installCloudSpaceHandlers('admin')
    roster([
      row(ALICE_ID, 'Alice', 'admin'),
      { ...row(BOB_ID, 'Bob', 'member'), status: 'disabled' },
    ])
    renderWithProviders(<MembersPage slug="cloud-dev" />, { slug: 'cloud-dev' })
    expect(await screen.findByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('重新加入需再次核验或邀请')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Bob 的角色' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '恢复' })).not.toBeInTheDocument()
  })

  it('generates an invitation token only in the browser and displays its private link', async () => {
    installCloudSpaceHandlers('admin')
    roster([row(ALICE_ID, 'Alice', 'admin')])
    let token = ''
    server.use(
      http.post(`/api/v1/tenants/${TEST_TENANT_ID}/invitations`, async ({ request }) => {
        const body: unknown = await request.json()
        if (
          typeof body === 'object' &&
          body !== null &&
          'token' in body &&
          typeof body.token === 'string'
        )
          token = body.token
        return HttpResponse.json(
          { id: 'i', tenantId: TEST_TENANT_ID, version: 1, expiresAt: '2026-09-30T00:00:00Z' },
          { status: 201 },
        )
      }),
    )
    renderWithProviders(<MembersPage slug="cloud-dev" />, { slug: 'cloud-dev' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '生成邀请链接' }))
    await waitFor(() => expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/))
    expect(screen.getByLabelText('新生成的链接')).toHaveValue(
      `http://localhost:3000/join/invite/${token}`,
    )
  })

  it('searches employed people and rechecks a selected global id on add', async () => {
    installCloudSpaceHandlers('admin')
    roster([row(ALICE_ID, 'Alice', 'admin')])
    server.use(
      http.get('/auth/providers', () => HttpResponse.json({ providers: ['huawei-idaas'] })),
    )
    let addBody: unknown
    server.use(
      http.get(`/api/v1/tenants/${TEST_TENANT_ID}/people`, () =>
        HttpResponse.json({
          items: [
            { globalUserId: '1234', name: '张三', employeeNumber: '001', departmentName: '研发' },
          ],
        }),
      ),
      http.post(`/api/v1/tenants/${TEST_TENANT_ID}/members/huawei`, async ({ request }) => {
        addBody = await request.json()
        return HttpResponse.json({
          tenantId: TEST_TENANT_ID,
          userId: BOB_ID,
          role: 'member',
          status: 'active',
          version: 1,
          displayName: '张三',
        })
      }),
    )
    renderWithProviders(<MembersPage slug="cloud-dev" />, { slug: 'cloud-dev' })
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('搜索姓名或工号'), '张三')
    await user.click(await screen.findByRole('button', { name: '添加' }))
    await waitFor(() =>
      expect(addBody).toEqual({ keyword: '张三', globalUserId: '1234', role: 'member' }),
    )
  })

  it('generates an application link and approves a pending applicant', async () => {
    installCloudSpaceHandlers('admin')
    roster([row(ALICE_ID, 'Alice', 'admin')])
    let linkToken = ''
    let approval: unknown
    server.use(
      http.get(`/api/v1/tenants/${TEST_TENANT_ID}/join-requests`, () =>
        HttpResponse.json({
          items: [
            {
              id: 'request-1',
              tenantId: TEST_TENANT_ID,
              userId: BOB_ID,
              displayName: 'Bob',
              status: 'pending',
              version: 1,
            },
          ],
          nextCursor: '',
        }),
      ),
      http.post(`/api/v1/tenants/${TEST_TENANT_ID}/join-links`, async ({ request }) => {
        const body: unknown = await request.json()
        if (
          typeof body === 'object' &&
          body !== null &&
          'token' in body &&
          typeof body.token === 'string'
        )
          linkToken = body.token
        return HttpResponse.json(
          { id: 'link-1', tenantId: TEST_TENANT_ID, version: 1, expiresAt: '2026-10-23T00:00:00Z' },
          { status: 201 },
        )
      }),
      http.post(
        `/api/v1/tenants/${TEST_TENANT_ID}/join-requests/request-1/approve`,
        async ({ request }) => {
          approval = await request.json()
          return HttpResponse.json({ id: 'request-1', status: 'approved', version: 2 })
        },
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(<MembersPage slug="cloud-dev" />, { slug: 'cloud-dev' })
    await user.click(await screen.findByRole('button', { name: '生成申请链接' }))
    await waitFor(() => expect(linkToken).toMatch(/^[A-Za-z0-9_-]{43}$/))
    expect(screen.getByLabelText('新生成的链接')).toHaveValue(
      `http://localhost:3000/join/apply/${linkToken}`,
    )
    await user.click(await screen.findByRole('button', { name: '批准' }))
    await waitFor(() => expect(approval).toEqual({ version: 1 }))
  })

  it('revokes an existing invitation using its version without retrieving its token', async () => {
    installCloudSpaceHandlers('admin')
    roster([row(ALICE_ID, 'Alice', 'admin')])
    let revocation: unknown
    server.use(
      http.get(`/api/v1/tenants/${TEST_TENANT_ID}/invitations`, () =>
        HttpResponse.json({
          items: [
            {
              id: 'invitation-1',
              tenantId: TEST_TENANT_ID,
              expiresAt: '2026-09-30T00:00:00Z',
              version: 3,
              revokedAt: null,
            },
          ],
          nextCursor: '',
        }),
      ),
      http.delete(
        `/api/v1/tenants/${TEST_TENANT_ID}/invitations/invitation-1`,
        async ({ request }) => {
          revocation = await request.json()
          return HttpResponse.json({
            id: 'invitation-1',
            revokedAt: '2026-09-24T00:00:00Z',
            version: 4,
          })
        },
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(<MembersPage slug="cloud-dev" />, { slug: 'cloud-dev' })
    await user.click(await screen.findByRole('button', { name: '撤销' }))
    await waitFor(() => expect(revocation).toEqual({ version: 3 }))
  })
})
