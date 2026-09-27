import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Error as ApiError,
  Space,
  SpaceListItem,
  TenantCreated,
} from '@/api/generated.schemas'
import { getApiV1MeSpaces, getGetApiV1MeSpacesQueryKey } from '@/api/me/me'
import {
  getApiV1TenantsTidSpacesSpaceIdProjects,
  patchApiV1TenantsTidSpacesSpaceId,
} from '@/api/spaces/spaces'
import { postApiV1Tenants } from '@/api/tenants/tenants'
import { useSession } from '@/features/auth/session'
import type { ErrorType } from '@/lib/api-client'
import { readAllPages } from '@/lib/pagination'

/** Fresh idempotency key; the backend requires one on every POST/DELETE. */
function idempotencyKey(): string {
  return crypto.randomUUID()
}

/**
 * Returns the idempotency key for one logical mutation: minted the first time
 * `variables` is seen and reused for every later call with that same object.
 *
 * React Query re-invokes `mutationFn` for each retry of a `mutate()` call but
 * always passes the same variables object, so a retry replays the original key
 * and the backend dedupes it instead of running the mutation twice. A new
 * `mutate()` call carries fresh variables and therefore mints a fresh key, and
 * two overlapping calls can never share one because they never share variables.
 */
export function idempotencyKeyFor(
  pending: { current: { variables: unknown; key: string } | null },
  variables: unknown,
): string {
  const current = pending.current
  if (current !== null && current.variables === variables) return current.key
  const key = idempotencyKey()
  pending.current = { variables, key }
  return key
}

/** Per-hook slot backing {@link idempotencyKeyFor}. */
export function useIdempotencyKeys() {
  const pending = useRef<{ variables: unknown; key: string } | null>(null)
  return (variables: unknown): string => idempotencyKeyFor(pending, variables)
}

/**
 * Headers for one mutating request. The backend rejects a POST/DELETE without a
 * non-empty `Idempotency-Key` (400 `idempotency_key_required`) and dedupes a
 * replay that carries the same key, so the key must stay stable across retries
 * of the same logical mutation. `Content-Type` is repeated here because the
 * orval mutator spreads these options over the generated request config, which
 * replaces its headers object outright.
 */
export function mutationHeaders(key: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'Idempotency-Key': key }
}

/** Roles authorized by the tenant membership row. */
export type SpaceRole = 'admin' | 'member'

/** Keeps unknown server roles from accidentally gaining management controls. */
export function normalizeSpaceRole(role: string): SpaceRole {
  return role === 'admin' ? 'admin' : 'member'
}

/** The complete joined-space list; an empty list means onboarding is needed. */
export interface JoinedSpaces {
  spaces: SpaceListItem[] | undefined
  isPending: boolean
  isError: boolean
}

/** Loads spaces across all tenants after the gateway confirms the session. */
export function useJoinedSpaces(): JoinedSpaces {
  const { session } = useSession()
  const query = useQuery({
    queryKey: getGetApiV1MeSpacesQueryKey(),
    queryFn: async ({ signal }) => {
      const page = await readAllPages((after) =>
        getApiV1MeSpaces(after ? { limit: 100, after } : { limit: 100 }, undefined, signal),
      )
      return page.items
    },
    enabled: session.status === 'signed-in',
  })
  return {
    spaces: query.data,
    isPending: session.status !== 'signed-in' || query.isPending,
    isError: query.isError,
  }
}

/** The name and globally reserved slug of a new tenant's sole space. */
export interface CreateTenantInput {
  name: string
  slug: string
}

/** Creates a tenant and its sole space, then refreshes the switcher. */
export function useCreateTenant() {
  const queryClient = useQueryClient()
  const keyFor = useIdempotencyKeys()
  return useMutation<TenantCreated, ErrorType<ApiError>, CreateTenantInput>({
    mutationFn: (input) => postApiV1Tenants(input, { headers: mutationHeaders(keyFor(input)) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetApiV1MeSpacesQueryKey() })
    },
  })
}

/** A versioned rename that keeps tenant and space names aligned. */
export interface UpdateSpaceInput {
  name: string
  description: string
  version: number
}

/** Updates the active space and refreshes all joined-space projections. */
export function useUpdateSpace(tenantId: string | undefined, spaceId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation<Space, ErrorType<ApiError>, UpdateSpaceInput>({
    mutationFn: (input) => patchApiV1TenantsTidSpacesSpaceId(tenantId ?? '', spaceId ?? '', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetApiV1MeSpacesQueryKey() })
    },
  })
}

/** Lists projects only after the selected space resolves to its tenant. */
export function useSpaceProjects(tenantId: string | undefined, spaceId: string | undefined) {
  return useQuery({
    queryKey:
      tenantId && spaceId
        ? [`/api/v1/tenants/${tenantId}/spaces/${spaceId}/projects`]
        : ['space-projects', 'disabled'],
    queryFn: ({ signal }) =>
      getApiV1TenantsTidSpacesSpaceIdProjects(
        tenantId ?? '',
        spaceId ?? '',
        undefined,
        undefined,
        signal,
      ),
    enabled: !!tenantId && !!spaceId,
  })
}

export type { Space, SpaceListItem }
