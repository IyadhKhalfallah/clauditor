import type { TokenUsage, PricingConfig, TurnMetrics } from '../types.js'
import { MODEL_PRICING } from '../types.js'
import type { PricingResolver } from '../providers/types.js'

export interface CostEstimate {
  inputCost: number
  outputCost: number
  cacheCreationCost: number
  cacheReadCost: number
  totalCost: number
  savedVsUncached: number
}

/**
 * Estimate the cost of a token usage record.
 */
export function estimateCost(
  usage: TokenUsage,
  pricing?: PricingConfig
): CostEstimate {
  const p = pricing ?? MODEL_PRICING['claude-sonnet-4-6']

  const inputCost = (usage.input_tokens / 1_000_000) * p.inputPerMillion
  const outputCost = (usage.output_tokens / 1_000_000) * p.outputPerMillion
  const cacheCreationCost =
    (usage.cache_creation_input_tokens / 1_000_000) * p.cacheCreationPerMillion
  const cacheReadCost =
    (usage.cache_read_input_tokens / 1_000_000) * p.cacheReadPerMillion
  const totalCost = inputCost + outputCost + cacheCreationCost + cacheReadCost

  // What it would have cost if all cache tokens were regular input
  const uncachedInputCost =
    ((usage.input_tokens +
      usage.cache_creation_input_tokens +
      usage.cache_read_input_tokens) /
      1_000_000) *
    p.inputPerMillion
  const uncachedTotal = uncachedInputCost + outputCost
  const savedVsUncached = uncachedTotal - totalCost

  return {
    inputCost,
    outputCost,
    cacheCreationCost,
    cacheReadCost,
    totalCost,
    savedVsUncached: Math.max(0, savedVsUncached),
  }
}

/**
 * Detect model from assistant record and return appropriate pricing.
 * Accepts an optional PricingResolver for multi-provider support.
 */
export function getPricingForModel(modelId: string, pricingResolver?: PricingResolver): PricingConfig {
  if (pricingResolver) {
    return pricingResolver.getPricing(modelId)
  }
  // Fallback: check Claude pricing (backward compat)
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (modelId.startsWith(key)) {
      return pricing
    }
  }
  return MODEL_PRICING['claude-sonnet-4-6']
}

/**
 * Format a cost estimate for display.
 */
export function formatCost(cost: CostEstimate): string {
  return [
    `Input:         ${formatDollars(cost.inputCost)}`,
    `Output:        ${formatDollars(cost.outputCost)}`,
    `Cache create:  ${formatDollars(cost.cacheCreationCost)}`,
    `Cache read:    ${formatDollars(cost.cacheReadCost)}`,
    `Total:         ${formatDollars(cost.totalCost)}`,
    `Saved vs uncached: ${formatDollars(cost.savedVsUncached)}`,
  ].join('\n')
}

/**
 * Format usage numbers for display.
 */
export function formatUsage(usage: TokenUsage): string {
  return [
    `Input:         ${usage.input_tokens.toLocaleString()}`,
    `Output:        ${usage.output_tokens.toLocaleString()}`,
    `Cache reads:   ${usage.cache_read_input_tokens.toLocaleString()}`,
    `Cache writes:  ${usage.cache_creation_input_tokens.toLocaleString()}`,
  ].join('\n')
}

function formatDollars(amount: number): string {
  if (amount < 0.01) return `~$${amount.toFixed(4)}`
  return `~$${amount.toFixed(2)}`
}
