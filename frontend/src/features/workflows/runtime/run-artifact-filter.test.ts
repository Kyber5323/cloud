import { describe, expect, it } from 'vitest'
import { filterArtifacts, latestArtifact } from '@/features/workflows/runtime/run-artifact-filter'
import type { WorkflowArtifact } from '@/features/workflows/runtime/types'

/** One stored artifact; `createdAt` is the only ordering the filter reads. */
function artifact(id: string, nodeId: string, createdAt: string): WorkflowArtifact {
  return { id, runId: 'run-1', nodeId, kind: 'text', title: id, body: id, createdAt }
}

describe('filterArtifacts', () => {
  it('keeps the whole list, newest created first', () => {
    const samples = [
      artifact('old', 'a-1', '2026-09-20T10:00:00+08:00'),
      artifact('mid', 'a-2', '2026-09-21T10:00:00+08:00'),
      artifact('new', 'a-1', '2026-09-22T10:00:00+08:00'),
    ]
    expect(filterArtifacts(samples, { type: 'all' }).map((a) => a.id)).toEqual([
      'new',
      'mid',
      'old',
    ])
  })

  it('scopes to one node when asked, still newest first', () => {
    const samples = [
      artifact('own-old', 'a-1', '2026-09-20T10:00:00+08:00'),
      artifact('other', 'a-2', '2026-09-22T10:00:00+08:00'),
      artifact('own-new', 'a-1', '2026-09-23T10:00:00+08:00'),
    ]
    const scoped = filterArtifacts(samples, { type: 'node', nodeId: 'a-1' })
    expect(scoped.map((a) => a.id)).toEqual(['own-new', 'own-old'])
  })

  it('yields an empty list for an empty scope or source', () => {
    expect(filterArtifacts([], { type: 'all' })).toEqual([])
    expect(
      filterArtifacts([artifact('a', 'a-1', '2026-09-20T10:00:00+08:00')], {
        type: 'node',
        nodeId: 'missing',
      }),
    ).toEqual([])
  })
})

describe('latestArtifact', () => {
  it('returns the newest artifact of the whole run', () => {
    const samples = [
      artifact('old', 'a-1', '2026-09-20T10:00:00+08:00'),
      artifact('new', 'a-2', '2026-09-22T10:00:00+08:00'),
    ]
    expect(latestArtifact(samples)?.id).toBe('new')
  })

  it('returns null when nothing was produced', () => {
    expect(latestArtifact([])).toBeNull()
  })
})
