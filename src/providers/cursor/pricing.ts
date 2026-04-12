import type { PricingConfig } from '../../types.js'
import type { PricingResolver } from '../types.js'

/**
 * Cursor pricing — Cursor uses various models. These are the common ones
 * available through Cursor's model picker. Pricing is approximate based
 * on publicly available model pricing.
 */
export const CURSOR_MODELS: Record<string, PricingConfig> = {
  'gpt-4o': {
    model: 'gpt-4o',
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
    cacheCreationPerMillion: 3.125,
    cacheReadPerMillion: 1.25,
  },
  'gpt-4o-mini': {
    model: 'gpt-4o-mini',
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    cacheCreationPerMillion: 0.1875,
    cacheReadPerMillion: 0.075,
  },
  'claude-sonnet-4-6': {
    model: 'claude-sonnet-4-6',
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheCreationPerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  'cursor-small': {
    model: 'cursor-small',
    inputPerMillion: 0.5,
    outputPerMillion: 1.5,
    cacheCreationPerMillion: 0.625,
    cacheReadPerMillion: 0.125,
  },
}

export const cursorPricing: PricingResolver = {
  models: CURSOR_MODELS,
  defaultPricing: CURSOR_MODELS['gpt-4o'],
  getPricing(modelId: string): PricingConfig {
    for (const [key, pricing] of Object.entries(CURSOR_MODELS)) {
      if (modelId.startsWith(key)) return pricing
    }
    return this.defaultPricing
  },
}
