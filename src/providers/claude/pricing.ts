import type { PricingConfig } from '../../types.js'
import type { PricingResolver } from '../types.js'

export const CLAUDE_MODELS: Record<string, PricingConfig> = {
  'claude-sonnet-4-6': {
    model: 'claude-sonnet-4-6',
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheCreationPerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  'claude-opus-4-6': {
    model: 'claude-opus-4-6',
    inputPerMillion: 15.0,
    outputPerMillion: 75.0,
    cacheCreationPerMillion: 18.75,
    cacheReadPerMillion: 1.5,
  },
  'claude-haiku-4-5': {
    model: 'claude-haiku-4-5',
    inputPerMillion: 0.8,
    outputPerMillion: 4.0,
    cacheCreationPerMillion: 1.0,
    cacheReadPerMillion: 0.08,
  },
}

export const claudePricing: PricingResolver = {
  models: CLAUDE_MODELS,
  defaultPricing: CLAUDE_MODELS['claude-sonnet-4-6'],
  getPricing(modelId: string): PricingConfig {
    for (const [key, pricing] of Object.entries(CLAUDE_MODELS)) {
      if (modelId.startsWith(key)) return pricing
    }
    return this.defaultPricing
  },
}
