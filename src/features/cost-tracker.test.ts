import { describe, it, expect } from 'vitest'
import { estimateCost, getPricingForModel } from './cost-tracker.js'
import type { TokenUsage } from '../types.js'

describe('estimateCost', () => {
  it('calculates cost for basic usage', () => {
    const usage: TokenUsage = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
    const cost = estimateCost(usage)
    // Sonnet pricing: $3/1M input + $15/1M output
    expect(cost.inputCost).toBeCloseTo(3.0)
    expect(cost.outputCost).toBeCloseTo(15.0)
    expect(cost.totalCost).toBeCloseTo(18.0)
  })

  it('calculates cache savings correctly', () => {
    const usage: TokenUsage = {
      input_tokens: 100_000,
      output_tokens: 50_000,
      cache_creation_input_tokens: 200_000,
      cache_read_input_tokens: 500_000,
    }
    const cost = estimateCost(usage)

    // Cache read is 0.10x input price — significant savings
    expect(cost.cacheReadCost).toBeLessThan(cost.inputCost)
    expect(cost.savedVsUncached).toBeGreaterThan(0)
  })

  it('returns zero savings when no cache is used', () => {
    const usage: TokenUsage = {
      input_tokens: 100_000,
      output_tokens: 50_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
    const cost = estimateCost(usage)
    expect(cost.savedVsUncached).toBe(0)
  })
})

describe('getPricingForModel', () => {
  it('returns Sonnet pricing for sonnet model', () => {
    const pricing = getPricingForModel('claude-sonnet-4-6-20260301')
    expect(pricing.inputPerMillion).toBe(3.0)
  })

  it('returns Opus pricing for opus model', () => {
    const pricing = getPricingForModel('claude-opus-4-6-20260401')
    expect(pricing.inputPerMillion).toBe(15.0)
  })

  it('falls back to Sonnet pricing for unknown models', () => {
    const pricing = getPricingForModel('some-unknown-model')
    expect(pricing.inputPerMillion).toBe(3.0)
  })
})
