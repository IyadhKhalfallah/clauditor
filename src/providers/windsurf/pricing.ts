import type { PricingConfig } from '../../types.js'
import type { PricingResolver } from '../types.js'

/**
 * Windsurf pricing — beyond-quota pricing as of early 2026.
 * Windsurf uses a credit system for most users, but charges per-token
 * beyond quota limits.
 */
export const WINDSURF_MODELS: Record<string, PricingConfig> = {
  'claude-sonnet-4-6': {
    model: 'claude-sonnet-4-6',
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheCreationPerMillion: 3.75,
    cacheReadPerMillion: 0.3,
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
  // Windsurf beyond-quota flat rate
  'windsurf-default': {
    model: 'windsurf-default',
    inputPerMillion: 0.5,
    outputPerMillion: 2.0,
    cacheCreationPerMillion: 0.625,
    cacheReadPerMillion: 0.1,
  },
}

export const windsurfPricing: PricingResolver = {
  models: WINDSURF_MODELS,
  defaultPricing: WINDSURF_MODELS['windsurf-default'],
  getPricing(modelId: string): PricingConfig {
    for (const [key, pricing] of Object.entries(WINDSURF_MODELS)) {
      if (modelId.startsWith(key)) return pricing
    }
    return this.defaultPricing
  },
}
