import { describe, expect, it } from 'vitest'
import { asJsonRecord, isJsonRecord } from '@/features/workflows/runtime/json-record'

describe('json record narrowing', () => {
  it('rebuilds a parsed object as a plain record', () => {
    const parsed: unknown = JSON.parse('{"a":1}')

    expect(asJsonRecord(parsed)).toEqual({ a: 1 })
  })

  it('refuses arrays, primitives, and null', () => {
    expect(asJsonRecord([])).toBeUndefined()
    expect(asJsonRecord('text')).toBeUndefined()
    expect(asJsonRecord(null)).toBeUndefined()
    expect(asJsonRecord(undefined)).toBeUndefined()
  })

  it('answers the same question in its boolean form', () => {
    expect(isJsonRecord({ a: 1 })).toBe(true)
    expect(isJsonRecord([])).toBe(false)
  })
})
