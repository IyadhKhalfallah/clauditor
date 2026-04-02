import { describe, it, expect } from 'vitest'
import { estimateQuotaBurnRate } from './quota-burn.js'
import type { TurnMetrics } from '../types.js'

function makeTurn(minutesAgo: number, tokens: { input: number; output: number; cacheRead: number; cacheCreate: number }): TurnMetrics {
  const ts = new Date(Date.now() - minutesAgo * 60_000)
  return {
    turnIndex: 0,
    timestamp: ts.toISOString(),
    cacheRatio: 0.9,
    toolCalls: [],
    usage: {
      input_tokens: tokens.input,
      output_tokens: tokens.output,
      cache_read_input_tokens: tokens.cacheRead,
      cache_creation_input_tokens: tokens.cacheCreate,
    },
  }
}

describe('estimateQuotaBurnRate', () => {
  it('returns zero for insufficient data', () => {
    const result = estimateQuotaBurnRate([])
    expect(result.tokensPerMinute).toBe(0)
    expect(result.burnRateStatus).toBe('normal')
  })

  it('estimates burn rate from recent turns', () => {
    const turns = [
      makeTurn(10, { input: 100, output: 500, cacheRead: 50000, cacheCreate: 1000 }),
      makeTurn(5, { input: 100, output: 500, cacheRead: 50000, cacheCreate: 1000 }),
      makeTurn(0, { input: 100, output: 500, cacheRead: 50000, cacheCreate: 1000 }),
    ]
    const result = estimateQuotaBurnRate(turns)
    expect(result.tokensPerMinute).toBeGreaterThan(0)
    expect(result.estimatedMinutesRemaining).toBeGreaterThan(0)
  })

  it('flags critical burn rate when draining fast with low cache ratio', () => {
    // High output + low cache ratio (cacheRead: 0) = broken cache + fast burn
    const turns = [
      makeTurn(2, { input: 1000, output: 100000, cacheRead: 0, cacheCreate: 50000 }),
      makeTurn(0, { input: 1000, output: 100000, cacheRead: 0, cacheCreate: 50000 }),
    ].map((t) => ({ ...t, cacheRatio: 0.02 })) // broken cache
    const result = estimateQuotaBurnRate(turns, 1_000_000)
    expect(result.burnRateStatus).toBe('critical')
  })

  it('shows normal for high burn rate with healthy cache', () => {
    // High output but 100% cache = Claude just working fast, not a problem
    const turns = [
      makeTurn(2, { input: 100, output: 100000, cacheRead: 200000, cacheCreate: 1000 }),
      makeTurn(0, { input: 100, output: 100000, cacheRead: 200000, cacheCreate: 1000 }),
    ]
    const result = estimateQuotaBurnRate(turns, 1_000_000)
    expect(result.burnRateStatus).toBe('normal')
  })

  it('shows normal for low burn rate', () => {
    const turns = [
      makeTurn(60, { input: 10, output: 50, cacheRead: 50000, cacheCreate: 100 }),
      makeTurn(0, { input: 10, output: 50, cacheRead: 50000, cacheCreate: 100 }),
    ]
    const result = estimateQuotaBurnRate(turns)
    expect(result.burnRateStatus).toBe('normal')
  })
})
