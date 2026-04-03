import { describe, it, expect } from 'vitest'
import { extractVersion, isBuggyCacheVersion } from './parser.js'
import type { SessionRecord } from '../types.js'

describe('extractVersion', () => {
  it('extracts version from user records', () => {
    const records: SessionRecord[] = [
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        sessionId: 's1',
        timestamp: '2026-04-03T12:00:00Z',
        message: { role: 'user', content: 'hello' },
        cwd: '/tmp',
        version: '2.1.91',
      } as SessionRecord,
    ]
    expect(extractVersion(records)).toBe('2.1.91')
  })

  it('returns null when no version present', () => {
    const records: SessionRecord[] = [
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        sessionId: 's1',
        timestamp: '2026-04-03T12:00:00Z',
        message: { role: 'user', content: 'hello' },
        cwd: '/tmp',
      } as SessionRecord,
    ]
    expect(extractVersion(records)).toBeNull()
  })

  it('returns most recent version from end of records', () => {
    const records: SessionRecord[] = [
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        sessionId: 's1',
        timestamp: '2026-04-03T12:00:00Z',
        message: { role: 'user', content: 'hello' },
        cwd: '/tmp',
        version: '2.1.80',
      } as SessionRecord,
      {
        type: 'user',
        uuid: 'u2',
        parentUuid: 'u1',
        sessionId: 's1',
        timestamp: '2026-04-03T13:00:00Z',
        message: { role: 'user', content: 'world' },
        cwd: '/tmp',
        version: '2.1.91',
      } as SessionRecord,
    ]
    // extractVersion reads from the end
    expect(extractVersion(records)).toBe('2.1.91')
  })
})

describe('isBuggyCacheVersion', () => {
  it('returns false for versions before the buggy range', () => {
    expect(isBuggyCacheVersion('2.1.68')).toBe(false)
    expect(isBuggyCacheVersion('2.1.0')).toBe(false)
    expect(isBuggyCacheVersion('2.0.100')).toBe(false)
    expect(isBuggyCacheVersion('1.5.80')).toBe(false)
  })

  it('returns true for buggy range 2.1.69 - 2.1.89', () => {
    expect(isBuggyCacheVersion('2.1.69')).toBe(true)
    expect(isBuggyCacheVersion('2.1.75')).toBe(true)
    expect(isBuggyCacheVersion('2.1.80')).toBe(true)
    expect(isBuggyCacheVersion('2.1.86')).toBe(true)
    expect(isBuggyCacheVersion('2.1.89')).toBe(true)
  })

  it('returns false for fixed versions', () => {
    expect(isBuggyCacheVersion('2.1.90')).toBe(false)
    expect(isBuggyCacheVersion('2.1.91')).toBe(false)
    expect(isBuggyCacheVersion('2.1.100')).toBe(false)
    expect(isBuggyCacheVersion('2.2.0')).toBe(false)
  })

  it('handles invalid version strings', () => {
    expect(isBuggyCacheVersion('')).toBe(false)
    expect(isBuggyCacheVersion('not-a-version')).toBe(false)
    expect(isBuggyCacheVersion('2.1')).toBe(false)
  })
})
