import { describe, it, expect } from 'vitest'
import { detectResumeAnomaly } from './resume-detector.js'
import type { TurnMetrics, TokenUsage } from '../types.js'

function makeTurn(overrides: Partial<TurnMetrics> & { usage: TokenUsage }): TurnMetrics {
  return {
    turnIndex: 0,
    timestamp: new Date().toISOString(),
    cacheRatio: 0.9,
    toolCalls: [],
    ...overrides,
  }
}

describe('detectResumeAnomaly', () => {
  it('returns no anomaly for non-resumed sessions', () => {
    const turns = [
      makeTurn({ usage: { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 5000 } }),
    ]
    const result = detectResumeAnomaly(turns, false)
    expect(result.detected).toBe(false)
    expect(result.resumeDetected).toBe(false)
  })

  it('detects output token spike after resume', () => {
    const turns = [
      makeTurn({ usage: { input_tokens: 100, output_tokens: 300, cache_creation_input_tokens: 1000, cache_read_input_tokens: 50000 } }),
      makeTurn({ usage: { input_tokens: 100, output_tokens: 250, cache_creation_input_tokens: 500, cache_read_input_tokens: 50000 } }),
      makeTurn({ usage: { input_tokens: 100, output_tokens: 652000, cache_creation_input_tokens: 500, cache_read_input_tokens: 50000 } }),
      makeTurn({ usage: { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 500, cache_read_input_tokens: 50000 } }),
    ]
    const result = detectResumeAnomaly(turns, true)
    expect(result.detected).toBe(true)
    expect(result.outputTokenSpike).toBe(652000)
  })

  it('detects cache invalidation after resume', () => {
    const turns = [
      makeTurn({ cacheRatio: 0.3, usage: { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 5000, cache_read_input_tokens: 1000 } }),
      makeTurn({ cacheRatio: 0.2, usage: { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 8000, cache_read_input_tokens: 1000 } }),
      makeTurn({ cacheRatio: 0.15, usage: { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 10000, cache_read_input_tokens: 1000 } }),
      makeTurn({ cacheRatio: 0.1, usage: { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 12000, cache_read_input_tokens: 1000 } }),
    ]
    const result = detectResumeAnomaly(turns, true)
    expect(result.detected).toBe(true)
    expect(result.cacheInvalidatedAfterResume).toBe(true)
  })

  it('does not flag normal resumed sessions', () => {
    const turns = [
      makeTurn({ usage: { input_tokens: 100, output_tokens: 300, cache_creation_input_tokens: 1000, cache_read_input_tokens: 50000 } }),
      makeTurn({ usage: { input_tokens: 100, output_tokens: 250, cache_creation_input_tokens: 500, cache_read_input_tokens: 55000 } }),
      makeTurn({ usage: { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 500, cache_read_input_tokens: 58000 } }),
      makeTurn({ usage: { input_tokens: 100, output_tokens: 280, cache_creation_input_tokens: 500, cache_read_input_tokens: 60000 } }),
    ]
    const result = detectResumeAnomaly(turns, true)
    expect(result.detected).toBe(false)
    expect(result.resumeDetected).toBe(true)
  })
})
