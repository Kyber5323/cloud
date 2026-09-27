import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import {
  getApiV1TenantsTidClones,
  getGetApiV1TenantsTidClonesQueryKey,
  postApiV1TenantsTidClones,
} from '@/api/clones/clones'
import {
  CloneStateKind,
  type Error as ApiError,
  type CloneOperation,
  type GetApiV1TenantsTidClones200,
} from '@/api/generated.schemas'
import type { CloneSubmission } from '@/features/clones/pending'
import { mutationHeaders } from '@/features/spaces/api'
import { faultCode, type ErrorType } from '@/lib/api-client'

/** The single page the list reads; the backend caps a page at 100. */
export const CLONE_LIST_LIMIT = 100

/** How often the list is re-read while a clone awaits its result or the last read failed. */
export const CLONE_POLL_INTERVAL_MS = 2000

const LIST_PARAMS = { limit: CLONE_LIST_LIMIT }

/** The member's clone operations as the page shows them. */
export interface CloneList {
  /** Newest submission first. */
  operations: CloneOperation[]
  /** True when Cloud holds more operations than the one page read. */
  truncated: boolean
}

/**
 * Orders operations newest first. Cloud pages clones by ascending random UUID, which carries no
 * time order, so the order is always derived here from `createdAt`, with the id as a tiebreak.
 */
export function newestFirst(operations: CloneOperation[]): CloneOperation[] {
  return operations.toSorted(
    (a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      a.operationId.localeCompare(b.operationId),
  )
}

/**
 * True while any operation still awaits its result. Pending means "no terminal fact yet", never
 * failure, so it is the only state worth polling for.
 */
export function awaitsResult(operations: CloneOperation[] | undefined): boolean {
  return operations?.some((operation) => operation.state.kind === CloneStateKind.pending) ?? false
}

function toCloneList(page: GetApiV1TenantsTidClones200): CloneList {
  return { operations: newestFirst(page.items), truncated: page.nextCursor !== '' }
}

/**
 * The signed-in member's clone operations in `tenantId`; Cloud shows each member only their own
 * submissions. Polls while a result is outstanding or the last read failed, and stops once every
 * operation is terminal. A failed re-read keeps the last facts in `data`.
 */
export function useCloneList(tenantId: string | undefined) {
  return useQuery({
    queryKey: getGetApiV1TenantsTidClonesQueryKey(tenantId ?? '', LIST_PARAMS),
    queryFn: ({ signal }) =>
      getApiV1TenantsTidClones(tenantId ?? '', LIST_PARAMS, undefined, signal),
    enabled: !!tenantId,
    select: toCloneList,
    refetchInterval: (query) =>
      query.state.status === 'error' || awaitsResult(query.state.data?.items)
        ? CLONE_POLL_INTERVAL_MS
        : false,
  })
}

/**
 * Submits one clone request. The request id doubles as the idempotency key, so a resend lands
 * in both of Cloud's replay layers. The list is re-read after every attempt, failed ones
 * included: a lost response may still have been accepted.
 */
export function useSubmitClone(tenantId: string) {
  const queryClient = useQueryClient()
  return useMutation<CloneOperation, ErrorType<ApiError>, CloneSubmission>({
    mutationFn: (submission) =>
      postApiV1TenantsTidClones(tenantId, submission, {
        headers: mutationHeaders(submission.requestId),
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: [`/api/v1/tenants/${tenantId}/clones`] }),
  })
}

/**
 * Why a submission failed. `rejected` means Cloud answered and refused it, so nothing was
 * accepted and the identity may be dropped; `unconfirmed` means acceptance is unknown (no
 * response, an expired session, a server or gateway failure) and the identity must be kept.
 */
export type SubmitFailure = { kind: 'rejected'; code: string | undefined } | { kind: 'unconfirmed' }

// Refusals a resend would only repeat. 401 and 429 are refusals too, but the same member resends
// the same request unchanged after signing in again or waiting, so the identity is kept for them.
const REFUSAL_STATUSES = new Set([400, 403, 404, 409, 422])

/** Classifies a failed submission; see {@link SubmitFailure}. */
export function classifySubmitFailure(error: unknown): SubmitFailure {
  const status = isAxiosError(error) ? error.response?.status : undefined
  if (status === undefined || !REFUSAL_STATUSES.has(status)) return { kind: 'unconfirmed' }
  return { kind: 'rejected', code: faultCode(error) }
}
