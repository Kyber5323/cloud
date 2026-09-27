import { describe, expect, it } from 'vitest'
import { formatNodeOutput } from '@/features/workflows/runtime/format-node-output'

describe('formatNodeOutput', () => {
  it('renders an absent output as empty text', () => {
    expect(formatNodeOutput(undefined)).toBe('')
  })

  it('keeps a plain string verbatim', () => {
    expect(formatNodeOutput('hello')).toBe('hello')
    expect(formatNodeOutput('')).toBe('')
  })

  it('pretty-prints structured output as indented JSON', () => {
    expect(formatNodeOutput({ ok: true, count: 2 })).toBe('{\n  "ok": true,\n  "count": 2\n}')
  })

  it('marks a value JSON cannot serialise instead of mangling it', () => {
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    expect(formatNodeOutput(circular)).toBe('[unserializable value]')
    expect(formatNodeOutput({ big: BigInt(1) })).toBe('[unserializable value]')
  })
})
