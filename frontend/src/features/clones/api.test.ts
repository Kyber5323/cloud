import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'
import type { CloneOperation } from '@/api/generated.schemas'
import { rejectionMessage } from './messages'
import { awaitsResult, classifySubmitFailure, newestFirst } from './api'

function operation(operationId: string, createdAt: string, kind: 'pending' | 'succeeded') {
  return {
    operationId,
    requestId: `request-${operationId}`,
    repository: 'https://github.com/octocat/Hello-World',
    branch: 'master',
    executionId: null,
    nodeId: null,
    state: { kind },
    createdAt,
    updatedAt: createdAt,
  } satisfies CloneOperation
}

function httpError(status: number, data: unknown) {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError('request failed', 'ERR_BAD_REQUEST', config, undefined, {
    status,
    statusText: '',
    data,
    headers: {},
    config,
  })
}

describe('newestFirst', () => {
  it('orders by creation time whatever order Cloud paged in, breaking ties by id', () => {
    const ordered = newestFirst([
      operation('b', '2026-09-23T08:00:00Z', 'pending'),
      operation('c', '2026-09-23T09:00:00+01:00', 'pending'),
      operation('a', '2026-09-23T08:00:00Z', 'pending'),
      operation('d', '2026-09-23T10:00:00Z', 'pending'),
    ])
    expect(ordered.map((o) => o.operationId)).toEqual(['d', 'a', 'b', 'c'])
  })
})

describe('awaitsResult', () => {
  it('is true only while some operation has no terminal fact yet', () => {
    expect(awaitsResult(undefined)).toBe(false)
    expect(awaitsResult([operation('a', '2026-09-23T08:00:00Z', 'succeeded')])).toBe(false)
    expect(
      awaitsResult([
        operation('a', '2026-09-23T08:00:00Z', 'succeeded'),
        operation('b', '2026-09-23T08:00:00Z', 'pending'),
      ]),
    ).toBe(true)
  })
})

describe('classifySubmitFailure', () => {
  it.each([400, 403, 404, 409, 422])('treats a %i refusal as rejected with its code', (status) => {
    expect(classifySubmitFailure(httpError(status, { code: 'invalid_ref' }))).toEqual({
      kind: 'rejected',
      code: 'invalid_ref',
    })
  })

  it.each([401, 429, 500, 502, 503])('keeps acceptance unknown after a %i', (status) => {
    expect(classifySubmitFailure(httpError(status, { code: 'x' }))).toEqual({
      kind: 'unconfirmed',
    })
  })

  it('keeps acceptance unknown when no response arrived or the error is not HTTP', () => {
    const lost = new AxiosError('Network Error', 'ERR_NETWORK')
    expect(classifySubmitFailure(lost)).toEqual({ kind: 'unconfirmed' })
    expect(classifySubmitFailure(new Error('boom'))).toEqual({ kind: 'unconfirmed' })
  })

  it('reports a refusal without a fault body as rejected with no code', () => {
    expect(classifySubmitFailure(httpError(400, ''))).toEqual({
      kind: 'rejected',
      code: undefined,
    })
  })
})

describe('rejectionMessage', () => {
  it('explains known fault codes and shows unknown ones verbatim', () => {
    expect(rejectionMessage('invalid_ref')).toContain('分支名无效')
    expect(rejectionMessage('brand_new_rule')).toBe('提交被拒绝：brand_new_rule')
    expect(rejectionMessage(undefined)).toBe('提交被拒绝：未知原因')
  })
})
