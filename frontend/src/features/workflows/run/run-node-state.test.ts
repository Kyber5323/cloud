import { describe, expect, it } from 'vitest'
import { parseRunNodeStates, type RunNodeEntry } from '@/features/workflows/run/run-node-state'

describe('parseRunNodeStates', () => {
  it('returns an empty map for a run that has no trace yet', () => {
    expect(parseRunNodeStates(undefined)).toEqual({})
  })

  it('reads one node row, keeping only its recognised fields', () => {
    const states = parseRunNodeStates({
      'a-1': {
        status: 'succeeded',
        displayName: 'Agent 1',
        startedAt: '2026-09-20T10:00:00+08:00',
        finishedAt: '2026-09-20T10:00:05+08:00',
        output: { ok: true },
        extra: 'ignored',
      },
    })
    expect(states['a-1']).toEqual({
      status: 'succeeded',
      displayName: 'Agent 1',
      startedAt: '2026-09-20T10:00:00+08:00',
      finishedAt: '2026-09-20T10:00:05+08:00',
      output: { ok: true },
    } satisfies RunNodeEntry)
  })

  it('keeps an explicitly falsy output when the row carries one', () => {
    const states = parseRunNodeStates({ 'a-1': { status: 'failed', output: 0 } })
    expect(states['a-1']?.output).toBe(0)
  })

  it('drops rows without a recognisable status', () => {
    const states = parseRunNodeStates({
      'a-1': 'running',
      'a-2': { phase: 'booting' },
      'a-3': { status: 'exploded' },
      'a-4': [1, 2],
      'a-5': null,
    })
    expect(states).toEqual({})
  })

  it('omits optional fields the row never set', () => {
    const states = parseRunNodeStates({ 'a-1': { status: 'idle' } })
    expect(states['a-1']).toEqual({ status: 'idle' } satisfies RunNodeEntry)
  })
})
