import type { CacheHealth, TurnMetrics } from '../types.js'

/**
 * Detect cache degradation from turn metrics.
 *
 * This detects a well-documented pattern reported in the Claude Code community:
 * after session resume, cache_read_input_tokens stops growing while
 * cache_creation_input_tokens keeps increasing — meaning conversation history
 * is reprocessed from scratch instead of reading from cache.
 *
 * Detection is based entirely on observable patterns in JSONL session files.
 */
export function detectCacheDegradation(turns: TurnMetrics[]): CacheHealth {
  if (turns.length < 3) {
    return {
      status: 'unknown',
      lastCacheRatio: turns.length > 0 ? turns[turns.length - 1].cacheRatio : 0,
      cacheRatioTrend: turns.map((t) => t.cacheRatio),
      degradationDetected: false,
    }
  }

  const recentTurns = turns.slice(-4)
  const cacheReadValues = recentTurns.map(
    (t) => t.usage.cache_read_input_tokens
  )
  const cacheCreateValues = recentTurns.map(
    (t) => t.usage.cache_creation_input_tokens
  )

  const lastRatio = recentTurns[recentTurns.length - 1]?.cacheRatio ?? 0

  // Degradation signature: cache_read is flat (low variance) while
  // cache_creation keeps growing — BUT only if the cache ratio is
  // actually low. High cache ratios with stable reads are healthy.
  const cacheReadVariance =
    Math.max(...cacheReadValues) - Math.min(...cacheReadValues)
  const cacheCreateGrowing =
    cacheCreateValues[cacheCreateValues.length - 1] >
    cacheCreateValues[0] * 1.5

  const degraded =
    cacheReadVariance < 500 &&
    cacheCreateGrowing &&
    lastRatio < 0.5 &&
    recentTurns.length >= 3

  const status: CacheHealth['status'] = degraded
    ? 'broken'
    : lastRatio >= 0.7
      ? 'healthy'
      : turns.length < 3
        ? 'unknown'
        : 'degraded'

  return {
    status,
    degradationDetected: degraded,
    lastCacheRatio: lastRatio,
    cacheRatioTrend: recentTurns.map((t) => t.cacheRatio),
  }
}

/**
 * Format a cache health status for display.
 */
export function formatCacheStatus(health: CacheHealth): string {
  switch (health.status) {
    case 'healthy':
      return `✓ healthy (${(health.lastCacheRatio * 100).toFixed(0)}% cache hit)`
    case 'degraded':
      return `⚠ degraded (${(health.lastCacheRatio * 100).toFixed(0)}% cache hit)`
    case 'broken':
      return `✗ broken — cache reprocessing detected`
    case 'unknown':
      return `? warming up`
  }
}

/**
 * Generate the degradation alert message.
 */
export function getCacheDegradationAlert(): string {
  return (
    '⚠️ Cache degradation detected — this session is reprocessing history ' +
    'as new tokens each turn. This can inflate costs 10-20x. ' +
    'Recommended: run `/clear` and re-state your context, or start a fresh session.'
  )
}
