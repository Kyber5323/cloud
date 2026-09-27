import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw-server'
import type { Issue, IssueStatusColumn, TenantMember } from '@/features/issues/types'

/**
 * Shared fixtures for tests that exercise the cloud-backed flow: a signed-in
 * session and one joined space whose slug is `cloud-dev`. Tests
 * install them with {@link installSignedInSession} (session only) or
 * {@link installCloudSpaceHandlers} (session and space). The
 * baseline server already answers the probe with 401, so "signed out" needs
 * no handler.
 */

export const TEST_TENANT_ID = '11111111-1111-1111-1111-111111111111'
export const TEST_SPACE_ID = '22222222-2222-2222-2222-222222222222'
export const TEST_USER_ID = '33333333-3333-3333-3333-333333333333'

/** The user `GET /api/v1/me` answers with for a signed-in test session. */
export const TEST_USER = {
  id: TEST_USER_ID,
  displayName: 'Alice',
  status: 'active',
  version: 1,
  createdAt: '2026-09-20T10:00:00+08:00',
  deletedAt: null,
}

/** Makes `GET /api/v1/me` answer as a signed-in member (the gateway cookie is implied). */
export function installSignedInSession(): void {
  server.use(http.get('/api/v1/me', () => HttpResponse.json(TEST_USER)))
}

/**
 * Installs MSW handlers for the shared cloud fixtures: a signed-in session,
 * one `cloud-dev` tenant space where the member holds the
 * given role.
 */
export function installCloudSpaceHandlers(role: string): void {
  installSignedInSession()
  server.use(
    http.get('/api/v1/me/spaces', () =>
      HttpResponse.json({
        items: [
          {
            id: TEST_SPACE_ID,
            tenantId: TEST_TENANT_ID,
            name: 'Cloud Dev',
            slug: 'cloud-dev',
            description: '',
            createdBy: TEST_USER_ID,
            version: 1,
            createdAt: '2026-09-20T10:00:00+08:00',
            updatedAt: '2026-09-20T10:00:00+08:00',
            archivedAt: null,
            role,
          },
        ],
        nextCursor: '',
      }),
    ),
  )
}

/**
 * Installs the three tenant queries an issue board/list mounts — issues,
 * statuses and members — for tests that exercise the `t1` tenant the fixtures
 * assume. Sharing one helper (instead of a per-file `serve*` trio) keeps the
 * clone detector quiet and makes the shape of the trio visible in one place.
 */
export function installTenantIssueHandlers(
  issues: Issue[] = [],
  statuses: IssueStatusColumn[] = [],
  members: TenantMember[] = [],
): void {
  server.use(
    http.get('/api/v1/tenants/t1/issues', () =>
      HttpResponse.json({ items: issues, nextCursor: '' }),
    ),
    http.get('/api/v1/tenants/t1/issue-statuses', () =>
      HttpResponse.json({ items: statuses, nextCursor: '' }),
    ),
    http.get('/api/v1/tenants/t1/members', () =>
      HttpResponse.json({ items: members, nextCursor: '' }),
    ),
  )
}
