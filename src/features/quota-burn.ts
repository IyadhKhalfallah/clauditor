import type { TurnMetrics, QuotaBurnRate, PricingConfig } from '../types.js'
import { MODEL_PRICING } from '../types.js'

/**
 * Estimate quota burn rate based on recent turn token usage over time.
 *
 * Based on community findings from GitHub issues #16157, #41930:
 * - Max 5x plan: ~$100/month worth of tokens
 * - Max 20x plan: ~$200/month worth of tokens
 * - Uncached tokens cost 10-20x more against quota
 *
 * This estimates how fast the user is burning through their session
 * based on the rate of token consumption over the last N turns.
 */

// Approximate quota budgets per plan (tokens per 5-hour window)
// These are estimates based on community observation, not official numbers
const ESTIMATED_QUOTA_TOKENS_PER_WINDOW = {
  max5x: 5_000_000,
  max20x: 20_000_000,
}

export function estimateQuotaBurnRate(
  turns: TurnMetrics[],
  quotaBudget: number = ESTIMATED_QUOTA_TOKENS_PER_WINDOW.max5x
): QuotaBurnRate {
  if (turns.length < 2) {
    return {
      tokensPerMinute: 0,
      estimatedMinutesRemaining: null,
      burnRateStatus: 'normal',
    }
  }

  // Calculate burn rate from the last 10 turns (or all turns if fewer)
  const recentTurns = turns.slice(-10)
  const firstTimestamp = new Date(recentTurns[0].timestamp).getTime()
  const lastTimestamp = new Date(recentTurns[recentTurns.length - 1].timestamp).getTime()
  const durationMinutes = (lastTimestamp - firstTimestamp) / 60_000

  if (durationMinutes <= 0) {
    return {
      tokensPerMinute: 0,
      estimatedMinutesRemaining: null,
      burnRateStatus: 'normal',
    }
  }

  // Total tokens consumed in the window (weighted: uncached tokens cost more)
  const totalWeightedTokens = recentTurns.reduce((sum, turn) => {
    // Uncached input tokens cost full price
    // Cache reads cost ~1/10th
    // Output tokens cost ~5x input
    // Cache creation costs ~1.25x input
    const weighted =
      turn.usage.input_tokens * 1.0 +
      turn.usage.cache_read_input_tokens * 0.1 +
      turn.usage.cache_creation_input_tokens * 1.25 +
      turn.usage.output_tokens * 5.0
    return sum + weighted
  }, 0)

  const tokensPerMinute = totalWeightedTokens / durationMinutes

  // Estimate total weighted tokens used so far in this session
  const totalSessionWeighted = turns.reduce((sum, turn) => {
    return sum +
      turn.usage.input_tokens * 1.0 +
      turn.usage.cache_read_input_tokens * 0.1 +
      turn.usage.cache_creation_input_tokens * 1.25 +
      turn.usage.output_tokens * 5.0
  }, 0)

  // Only estimate remaining time if we haven't already blown past the budget.
  // For subscription users, quota isn't a fixed token budget — showing "0min left"
  // is misleading. Only show estimates when they're meaningful.
  const remainingBudget = quotaBudget - totalSessionWeighted
  const estimatedMinutesRemaining =
    tokensPerMinute > 0 && remainingBudget > 0
      ? remainingBudget / tokensPerMinute
      : null

  // Classify burn rate. High throughput alone is NOT a problem — it just
  // means Claude is working fast. Only flag when combined with low cache
  // efficiency, which indicates wasted reprocessing.
  //
  // The burn rate status is advisory — the real signal comes from cache
  // health. We compute it here but leave it to the alerts layer to
  // combine with cache ratio before showing warnings.
  const lastCacheRatio = recentTurns[recentTurns.length - 1]?.cacheRatio ?? 1

  let burnRateStatus: QuotaBurnRate['burnRateStatus'] = 'normal'
  if (lastCacheRatio < 0.5 && tokensPerMinute > 30_000) {
    // High burn + broken cache = critical
    burnRateStatus = 'critical'
  } else if (lastCacheRatio < 0.5 && tokensPerMinute > 10_000) {
    // Moderate burn + broken cache = elevated
    burnRateStatus = 'elevated'
  } else if (estimatedMinutesRemaining !== null && estimatedMinutesRemaining < 30 && lastCacheRatio < 0.7) {
    burnRateStatus = 'critical'
  }

  return {
    tokensPerMinute: Math.round(tokensPerMinute),
    estimatedMinutesRemaining: estimatedMinutesRemaining !== null
      ? Math.round(estimatedMinutesRemaining)
      : null,
    burnRateStatus,
  }
}

/**
 * Format burn rate for display.
 */
export function formatBurnRate(burn: QuotaBurnRate): string {
  if (burn.tokensPerMinute === 0) return 'No data yet'

  const rate = `${(burn.tokensPerMinute / 1000).toFixed(0)}k weighted tokens/min`

  if (burn.estimatedMinutesRemaining === null) return rate

  const mins = burn.estimatedMinutesRemaining
  const timeLeft = mins >= 60
    ? `~${(mins / 60).toFixed(1)}h remaining`
    : `~${mins}min remaining`

  return `${rate} · ${timeLeft}`
}
