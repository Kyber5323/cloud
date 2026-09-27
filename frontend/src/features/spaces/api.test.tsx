import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { Project } from '@/api/generated.schemas'
import { server } from '@/test/msw-server'
import { useCreateTenant, useSpaceProjects } from './api'

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const SPACE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const SPACE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useCreateTenant', () => {
  it('reuses the idempotency key when a request is retried', async () => {
    const keys: Array<string | null> = []
    server.use(
      http.post('/api/v1/tenants', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'))
        if (keys.length === 1) return new HttpResponse(null, { status: 500 })
        return HttpResponse.json({ tenant: { id: TENANT_ID }, space: { id: SPACE_A } })
      }),
    )
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 1, retryDelay: 0 } } })
    const { result } = renderHook(() => useCreateTenant(), { wrapper: wrapper(client) })
    result.current.mutate({ name: 'Team', slug: 'team' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
  })
})

describe('useSpaceProjects', () => {
  function project(spaceId: string): Project {
    return {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      tenantId: TENANT_ID,
      name: `Project in ${spaceId}`,
      repositoryUrl: 'https://example.com/repo.git',
      defaultBranch: 'main',
      ownerUserId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      spaceId,
      lifecycle: 'active',
      version: 1,
      createdAt: '2026-09-21T10:00:00Z',
      deletedAt: null,
      credentialRefId: null,
    }
  }

  it('rekeys the project list when the selected space changes', async () => {
    server.use(
      http.get(`/api/v1/tenants/${TENANT_ID}/spaces/${SPACE_A}/projects`, () =>
        HttpResponse.json({ items: [project(SPACE_A)], nextCursor: '' }),
      ),
      http.get(`/api/v1/tenants/${TENANT_ID}/spaces/${SPACE_B}/projects`, () =>
        HttpResponse.json({ items: [project(SPACE_B)], nextCursor: '' }),
      ),
    )
    const client = new QueryClient()
    const { result, rerender } = renderHook(
      ({ spaceId }: { spaceId: string }) => useSpaceProjects(TENANT_ID, spaceId),
      { wrapper: wrapper(client), initialProps: { spaceId: SPACE_A } },
    )
    await waitFor(() => expect(result.current.data?.items[0]?.spaceId).toBe(SPACE_A))
    rerender({ spaceId: SPACE_B })
    await waitFor(() => expect(result.current.data?.items[0]?.spaceId).toBe(SPACE_B))
    expect(
      client.getQueryData([`/api/v1/tenants/${TENANT_ID}/spaces/${SPACE_A}/projects`]),
    ).toBeTruthy()
  })
})
