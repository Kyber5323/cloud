import type { PostApiV1TenantsTidClonesBody } from '@/api/generated.schemas'

/**
 * One clone submission exactly as the browser sends it. `requestId` is the caller's durable
 * identity: resending the same triple returns the original operation instead of cloning twice.
 */
export type CloneSubmission = PostApiV1TenantsTidClonesBody

/**
 * What the tab remembers about a submission it has not seen accepted or refused. `unreadable`
 * means the tab cannot tell whether a request is in flight, so no new identity may be minted.
 */
export type PendingSubmission =
  | { status: 'none' }
  | { status: 'unconfirmed'; submission: CloneSubmission }
  | { status: 'unreadable' }

const KEY_PREFIX = 'ora.clones.pending.v1'

/**
 * Storage key of one member's unconfirmed submission. Scoping by tenant and user keeps a
 * submission typed under one account from being resent by another account signed in to the
 * same tab.
 */
export function pendingSubmissionKey(tenantId: string, userId: string): string {
  return `${KEY_PREFIX}:${tenantId}:${userId}`
}

function isSubmission(value: unknown): value is CloneSubmission {
  return (
    typeof value === 'object' &&
    value !== null &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    'repository' in value &&
    typeof value.repository === 'string' &&
    'branch' in value &&
    typeof value.branch === 'string'
  )
}

/**
 * Reads the unconfirmed submission stored under `key` in the tab's session storage. Storage that
 * throws, or holds anything but a well-formed submission, reads as `unreadable` rather than
 * `none`: forgetting it could mint a second identity for work Cloud already accepted.
 */
export function readPendingSubmission(key: string): PendingSubmission {
  let raw: string | null
  try {
    raw = window.sessionStorage.getItem(key)
  } catch {
    return { status: 'unreadable' }
  }
  if (raw === null) return { status: 'none' }
  try {
    const value: unknown = JSON.parse(raw)
    if (isSubmission(value)) {
      const { requestId, repository, branch } = value
      return { status: 'unconfirmed', submission: { requestId, repository, branch } }
    }
  } catch {
    // Malformed JSON is reported below exactly like a well-formed value of the wrong shape.
  }
  return { status: 'unreadable' }
}

/**
 * Stores `submission` under `key` before it is sent, or forgets it (`null`) once Cloud's answer
 * is known.
 *
 * @throws When session storage refuses the write; callers keep the submission locked instead of
 *   sending an identity the tab could not remember.
 */
export function writePendingSubmission(key: string, submission: CloneSubmission | null): void {
  if (submission) window.sessionStorage.setItem(key, JSON.stringify(submission))
  else window.sessionStorage.removeItem(key)
}
