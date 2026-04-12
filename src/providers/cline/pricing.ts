import type { PricingConfig } from '../../types.js'
import type { PricingResolver } from '../types.js'

/** Cline supports many providers — these are the most common models used. */
export const CLINE_MODELS: Record<string, PricingConfig> = {
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
  'gpt-4o': {
    model: 'gpt-4o',
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
    cacheCreationPerMillion: 3.125,
    cacheReadPerMillion: 1.25,
  },
  'gemini-2.5-pro': {
    model: 'gemini-2.5-pro',
    inputPerMillion: 1.25,
    outputPerMillion: 10.0,
    cacheCreationPerMillion: 1.5625,
    cacheReadPerMillion: 0.3125,
  },
  'deepseek-chat': {
    model: 'deepseek-chat',
    inputPerMillion: 0.27,
    outputPerMillion: 1.10,
    cacheCreationPerMillion: 0.27,
    cacheReadPerMillion: 0.07,
  },
}

export const clinePricing: PricingResolver = {
  models: CLINE_MODELS,
  defaultPricing: CLINE_MODELS['claude-sonnet-4-6'],
  getPricing(modelId: string): PricingConfig {
    for (const [key, pricing] of Object.entries(CLINE_MODELS)) {
      if (modelId.startsWith(key)) return pricing
    }
    return this.defaultPricing
  },
}
