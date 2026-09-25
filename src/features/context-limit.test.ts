import { describe, it, expect } from 'vitest'
import { getContextLimit } from './context-limit.js'

describe('getContextLimit', () => {
  it('gives Opus the 1M window at any size', () => {
    expect(getContextLimit('claude-opus-4-6', 10_000)).toBe(1_000_000)
  })

  it('gives other models 200k while the context fits in 200k', () => {
    expect(getContextLimit('claude-sonnet-4-6', 190_000)).toBe(200_000)
    expect(getContextLimit('claude-sonnet-4-6', 200_000)).toBe(200_000)
  })

  it('switches to 1M once the context is past 200k (1M window in use)', () => {
    expect(getContextLimit('claude-sonnet-4-6', 300_000)).toBe(1_000_000)
  })

  it('handles a missing model', () => {
    expect(getContextLimit(undefined, 50_000)).toBe(200_000)
    expect(getContextLimit(null, 250_000)).toBe(1_000_000)
  })
})
