import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  pendingSubmissionKey,
  readPendingSubmission,
  writePendingSubmission,
  type CloneSubmission,
} from './pending'

const KEY = pendingSubmissionKey('tenant-a', 'user-a')
const SUBMISSION: CloneSubmission = {
  requestId: 'request-1',
  repository: 'https://github.com/octocat/Hello-World',
  branch: 'master',
}

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('pendingSubmissionKey', () => {
  it('gives every tenant and user of one tab a separate slot', () => {
    const keys = new Set([
      pendingSubmissionKey('tenant-a', 'user-a'),
      pendingSubmissionKey('tenant-a', 'user-b'),
      pendingSubmissionKey('tenant-b', 'user-a'),
    ])
    expect(keys.size).toBe(3)
  })
})

describe('readPendingSubmission', () => {
  it('reads nothing pending from an empty slot', () => {
    expect(readPendingSubmission(KEY)).toEqual({ status: 'none' })
  })

  it('returns exactly the submission written before sending, without extra fields', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ ...SUBMISSION, extra: 'ignored' }))
    expect(readPendingSubmission(KEY)).toEqual({ status: 'unconfirmed', submission: SUBMISSION })
  })

  it.each([
    ['malformed JSON', '{'],
    ['a value of the wrong shape', JSON.stringify({ requestId: 1, repository: 'x', branch: 'y' })],
    ['a non-object value', JSON.stringify('request-1')],
  ])('treats %s as unreadable rather than as nothing pending', (_label, raw) => {
    sessionStorage.setItem(KEY, raw)
    expect(readPendingSubmission(KEY)).toEqual({ status: 'unreadable' })
  })

  it('treats storage that throws as unreadable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied')
    })
    expect(readPendingSubmission(KEY)).toEqual({ status: 'unreadable' })
  })
})

describe('writePendingSubmission', () => {
  it('stores a submission and forgets it on null', () => {
    writePendingSubmission(KEY, SUBMISSION)
    expect(readPendingSubmission(KEY)).toEqual({ status: 'unconfirmed', submission: SUBMISSION })
    writePendingSubmission(KEY, null)
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('propagates a refused write so the caller never sends an unremembered identity', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() => writePendingSubmission(KEY, SUBMISSION)).toThrow('quota exceeded')
  })
})
