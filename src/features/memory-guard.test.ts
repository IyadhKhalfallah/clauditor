import { describe, it, expect } from 'vitest'
import { estimateTokens } from './memory-guard.js'

describe('estimateTokens', () => {
  it('estimates tokens from character count', () => {
    expect(estimateTokens('hello')).toBe(2) // 5/4 = 1.25 → ceil = 2
    expect(estimateTokens('a'.repeat(100))).toBe(25)
    expect(estimateTokens('')).toBe(0)
  })

  it('handles multi-byte characters', () => {
    const result = estimateTokens('こんにちは')
    expect(result).toBeGreaterThan(0)
  })
})
