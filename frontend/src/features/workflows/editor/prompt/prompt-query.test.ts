import { describe, expect, it } from 'vitest'
import {
  promptQueryStatusesEqual,
  promptSlashQueryFromText,
} from '@/features/workflows/editor/prompt/prompt-query'

describe('promptSlashQueryFromText', () => {
  it('reads the token a caret inside a slash query is typing', () => {
    expect(promptSlashQueryFromText('使用变量 /start.out')).toBe('start.out')
    expect(promptSlashQueryFromText('使用变量 /')).toBe('')
    expect(promptSlashQueryFromText('/agen')).toBe('agen')
  })

  it('stays null for a caret outside any slash token', () => {
    expect(promptSlashQueryFromText('普通文字')).toBeNull()
    expect(promptSlashQueryFromText('')).toBeNull()
  })

  it('does not treat a slash followed by whitespace as a query trigger', () => {
    expect(promptSlashQueryFromText('1 / 2')).toBeNull()
    expect(promptSlashQueryFromText('使用 / 变量')).toBeNull()
  })

  it('is lenient about a mid-word slash, matching from the latest one', () => {
    expect(promptSlashQueryFromText('foo/bar')).toBe('bar')
    expect(promptSlashQueryFromText('//x')).toBe('x')
    expect(promptSlashQueryFromText('a//b')).toBe('b')
  })
})

describe('promptQueryStatusesEqual', () => {
  it('compares two query states by identity', () => {
    expect(promptQueryStatusesEqual(null, null)).toBe(true)
    expect(promptQueryStatusesEqual('ab', 'ab')).toBe(true)
    expect(promptQueryStatusesEqual('a', 'b')).toBe(false)
    expect(promptQueryStatusesEqual(null, 'a')).toBe(false)
  })
})
