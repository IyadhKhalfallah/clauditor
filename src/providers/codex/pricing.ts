import type { PricingConfig } from '../../types.js'
import type { PricingResolver } from '../types.js'

export const CODEX_MODELS: Record<string, PricingConfig> = {
  'gpt-4.1': {
    model: 'gpt-4.1',
    inputPerMillion: 2.0,
    outputPerMillion: 8.0,
    cacheCreationPerMillion: 2.5,
    cacheReadPerMillion: 0.5,
  },
  'gpt-4.1-mini': {
    model: 'gpt-4.1-mini',
    inputPerMillion: 0.4,
    outputPerMillion: 1.6,
    cacheCreationPerMillion: 0.5,
    cacheReadPerMillion: 0.1,
  },
  'gpt-4.1-nano': {
    model: 'gpt-4.1-nano',
    inputPerMillion: 0.1,
    outputPerMillion: 0.4,
    cacheCreationPerMillion: 0.125,
    cacheReadPerMillion: 0.025,
  },
  'o3': {
    model: 'o3',
    inputPerMillion: 2.0,
    outputPerMillion: 8.0,
    cacheCreationPerMillion: 2.5,
    cacheReadPerMillion: 0.5,
  },
  'o4-mini': {
    model: 'o4-mini',
    inputPerMillion: 1.1,
    outputPerMillion: 4.4,
    cacheCreationPerMillion: 1.375,
    cacheReadPerMillion: 0.275,
  },
  'o3-pro': {
    model: 'o3-pro',
    inputPerMillion: 20.0,
    outputPerMillion: 80.0,
    cacheCreationPerMillion: 25.0,
    cacheReadPerMillion: 5.0,
  },
}

export const codexPricing: PricingResolver = {
  models: CODEX_MODELS,
  defaultPricing: CODEX_MODELS['o4-mini'],
  getPricing(modelId: string): PricingConfig {
    for (const [key, pricing] of Object.entries(CODEX_MODELS)) {
      if (modelId.startsWith(key)) return pricing
    }
    return this.defaultPricing
  },
}
