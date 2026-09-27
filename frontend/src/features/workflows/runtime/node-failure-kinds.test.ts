import { describe, expect, it } from 'vitest'
import {
  asNodeFailureKind,
  NODE_FAILURE_KINDS,
} from '@/features/workflows/runtime/node-failure-kinds'

describe('asNodeFailureKind', () => {
  it('narrows every declared kind to itself', () => {
    for (const kind of NODE_FAILURE_KINDS) {
      expect(asNodeFailureKind(kind)).toBe(kind)
    }
  })

  it('rejects a bare string that names no known kind', () => {
    expect(asNodeFailureKind('engine_exploded')).toBeUndefined()
  })

  it('rejects non-string persisted values', () => {
    expect(asNodeFailureKind(42)).toBeUndefined()
    expect(asNodeFailureKind({ kind: 'session' })).toBeUndefined()
    expect(asNodeFailureKind(null)).toBeUndefined()
    expect(asNodeFailureKind(undefined)).toBeUndefined()
  })
})

describe('NODE_FAILURE_KINDS', () => {
  it('declares a distinct list with no accidental duplicates', () => {
    expect(new Set(NODE_FAILURE_KINDS).size).toBe(NODE_FAILURE_KINDS.length)
    expect(NODE_FAILURE_KINDS.length).toBeGreaterThan(0)
  })
})
