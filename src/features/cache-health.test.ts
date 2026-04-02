import { describe, it, expect } from 'vitest'
import { detectCacheDegradation } from './cache-health.js'
import type { TurnMetrics } from '../types.js'

function makeTurn(
  turnIndex: number,
  input: number,
  cacheCreate: number,
  cacheRead: number
): TurnMetrics {
  const total = input + cacheCreate + cacheRead
  return {
    turnIndex,
    timestamp: `2025-01-01T00:0${turnIndex}:00Z`,
    usage: {
      input_tokens: input,
      output_tokens: 50,
      cache_creation_input_tokens: cacheCreate,
      cache_read_input_tokens: cacheRead,
    },
    cacheRatio: total > 0 ? cacheRead / total : 0,
    toolCalls: [],
  }
}

describe('detectCacheDegradation', () => {
  it('returns unknown for fewer than 3 turns', () => {
    const turns = [makeTurn(0, 100, 200, 0), makeTurn(1, 50, 100, 300)]
    const result = detectCacheDegradation(turns)
    expect(result.status).toBe('unknown')
    expect(result.degradationDetected).toBe(false)
  })

  it('detects healthy cache with high ratio', () => {
    const turns = [
      makeTurn(0, 100, 500, 0),
      makeTurn(1, 50, 100, 800),
      makeTurn(2, 50, 50, 2000),
      makeTurn(3, 50, 30, 5000),
    ]
    const result = detectCacheDegradation(turns)
    expect(result.status).toBe('healthy')
    expect(result.degradationDetected).toBe(false)
    expect(result.lastCacheRatio).toBeGreaterThan(0.7)
  })

  it('detects broken cache — flat cache_read + growing cache_creation', () => {
    const turns = [
      makeTurn(0, 100, 1000, 50),
      makeTurn(1, 100, 2000, 50),
      makeTurn(2, 100, 3000, 50),
      makeTurn(3, 100, 4000, 50),
    ]
    const result = detectCacheDegradation(turns)
    expect(result.status).toBe('broken')
    expect(result.degradationDetected).toBe(true)
  })

  it('detects degraded cache — low ratio after warmup', () => {
    const turns = [
      makeTurn(0, 100, 500, 0),
      makeTurn(1, 100, 400, 100),
      makeTurn(2, 100, 300, 200),
    ]
    const result = detectCacheDegradation(turns)
    // ratio at turn 2 is 200/600 = 0.33 < 0.4
    expect(result.status).toBe('degraded')
    expect(result.degradationDetected).toBe(false)
  })

  it('includes cache ratio trend', () => {
    const turns = [
      makeTurn(0, 100, 500, 0),
      makeTurn(1, 50, 100, 800),
      makeTurn(2, 50, 50, 2000),
    ]
    const result = detectCacheDegradation(turns)
    expect(result.cacheRatioTrend).toHaveLength(3)
  })
})
