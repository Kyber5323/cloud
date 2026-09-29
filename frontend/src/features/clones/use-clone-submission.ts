import { useEffect, useState } from 'react'
import type { CloneOperation } from '@/api/generated.schemas'
import { classifySubmitFailure, useSubmitClone } from '@/features/clones/api'
import {
  rejectionMessage,
  STORAGE_CLEAR_FAILED_NOTICE,
  STORAGE_WRITE_FAILED_NOTICE,
  UNCONFIRMED_NOTICE,
} from '@/features/clones/messages'
import {
  pendingSubmissionKey,
  readPendingSubmission,
  writePendingSubmission,
  type CloneSubmission,
  type PendingSubmission,
} from '@/features/clones/pending'

/** Repository and branch as the member typed them; the flow trims them before sending. */
export interface CloneInput {
  repository: string
  branch: string
}

/** The submission state machine one member's clones page drives. */
export interface CloneSubmissionFlow {
  /** The tab's unconfirmed submission, if any; while one exists every submit resends it. */
  pending: PendingSubmission
  /** The latest outcome worth telling the member; cleared when a new attempt starts. */
  notice: string | null
  /** True while a submission is on the wire. */
  busy: boolean
  /**
   * Sends a new submission, or resends the unconfirmed one unchanged (then `input` is ignored).
   * Resolves `true` once Cloud accepted it; never rejects.
   */
  submit: (input: CloneInput) => Promise<boolean>
}

function newSubmission(input: CloneInput): CloneSubmission {
  return {
    requestId: crypto.randomUUID(),
    repository: input.repository.trim(),
    branch: input.branch.trim(),
  }
}

/**
 * Owns one member's clone submissions in one tenant. The identity is written to session storage
 * before it is sent and forgotten only once Cloud's answer is known, so a lost response or a
 * reload resends the same request instead of cloning twice. Callers remount the owning component
 * when the tenant or user changes, which re-reads storage under the new key.
 *
 * `operations` is the member's current list: seeing the unconfirmed request id there proves Cloud
 * accepted it, which confirms the submission without a resend.
 */
export function useCloneSubmission({
  tenantId,
  userId,
  operations,
}: {
  tenantId: string
  userId: string
  operations: CloneOperation[] | undefined
}): CloneSubmissionFlow {
  const key = pendingSubmissionKey(tenantId, userId)
  const [pending, setPending] = useState<PendingSubmission>(() => readPendingSubmission(key))
  const [notice, setNotice] = useState<string | null>(null)
  const mutation = useSubmitClone(tenantId)

  function forget() {
    try {
      writePendingSubmission(key, null)
      setPending({ status: 'none' })
    } catch {
      setNotice(STORAGE_CLEAR_FAILED_NOTICE)
    }
  }

  // Cloud lists the request id only if it accepted that exact submission, so a listed one is
  // confirmed whatever storage still says. Deriving it here rather than storing it means a stale
  // entry that storage refuses to drop is re-derived as confirmed on every read.
  const listed =
    pending.status === 'unconfirmed' &&
    (operations?.some((operation) => operation.requestId === pending.submission.requestId) ?? false)
  const current: PendingSubmission = listed ? { status: 'none' } : pending
  useEffect(() => {
    if (!listed) return
    try {
      writePendingSubmission(key, null)
    } catch {
      // Harmless: the listed request id keeps this submission confirmed after any reload.
    }
  }, [listed, key])

  async function submit(input: CloneInput): Promise<boolean> {
    if (current.status === 'unreadable' || mutation.isPending) return false
    const submission = current.status === 'unconfirmed' ? current.submission : newSubmission(input)
    setNotice(null)
    try {
      writePendingSubmission(key, submission)
    } catch {
      setNotice(STORAGE_WRITE_FAILED_NOTICE)
      return false
    }
    setPending({ status: 'unconfirmed', submission })
    try {
      await mutation.mutateAsync(submission)
    } catch (error) {
      const failure = classifySubmitFailure(error)
      if (failure.kind === 'unconfirmed') {
        setNotice(UNCONFIRMED_NOTICE)
        return false
      }
      setNotice(rejectionMessage(failure.code))
      forget()
      return false
    }
    forget()
    return true
  }

  return { pending: current, notice, busy: mutation.isPending, submit }
}
