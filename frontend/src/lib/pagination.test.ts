import { describe, expect, it } from 'vitest'
import { readAllPages } from './pagination'

describe('readAllPages', () => {
  it('includes rows after the first page in cursor order', async () => {
    const cursors: (string | undefined)[] = []
    const result = await readAllPages(async (after) => {
      cursors.push(after)
      if (!after) return { items: ['first'], nextCursor: 'first-id' }
      return { items: ['second'], nextCursor: '' }
    })

    expect(cursors).toEqual([undefined, 'first-id'])
    expect(result).toEqual({ items: ['first', 'second'], nextCursor: '' })
  })
})
