import type { TurnMetrics, ResumeAnomaly, SessionRecord, CompactBoundaryRecord } from '../types.js'

/**
 * Detect anomalous token usage after session resume.
 *
 * Based on GitHub issue #38029: users observed 652K output tokens
 * generated silently during session resume with no user input.
 * And issue #40524: cache invalidation after resume causes cache_read
 * to go flat while cache_creation spikes.
 *
 * Detection logic:
 * 1. Check if session has a compact_boundary (indicates resume)
 * 2. Check if the first turn after resume has abnormally high output tokens
 * 3. Check if cache was invalidated after resume (cache_read drops, cache_creation spikes)
 */
export function detectResumeAnomaly(
  turns: TurnMetrics[],
  hasCompactBoundary: boolean
): ResumeAnomaly {
  const result: ResumeAnomaly = {
    detected: false,
    resumeDetected: hasCompactBoundary,
    outputTokenSpike: null,
    cacheInvalidatedAfterResume: false,
  }

  if (!hasCompactBoundary || turns.length < 2) return result

  // Find the median output tokens for "normal" turns
  const outputTokens = turns.map((t) => t.usage.output_tokens).sort((a, b) => a - b)
  const median = outputTokens[Math.floor(outputTokens.length / 2)]

  // Check for output token spike: any turn with >10x median output
  // (the #38029 bug showed 652K tokens vs normal ~200-500)
  const spikeThreshold = Math.max(median * 10, 10000)
  for (const turn of turns) {
    if (turn.usage.output_tokens > spikeThreshold) {
      result.detected = true
      result.outputTokenSpike = turn.usage.output_tokens
      break
    }
  }

  // Check for cache invalidation after resume (#40524 pattern):
  // After compact_boundary, cache_read stays flat while cache_creation grows
  if (turns.length >= 4) {
    const lastFour = turns.slice(-4)
    const cacheReads = lastFour.map((t) => t.usage.cache_read_input_tokens)
    const cacheCreates = lastFour.map((t) => t.usage.cache_creation_input_tokens)

    const readVariance = Math.max(...cacheReads) - Math.min(...cacheReads)
    const createGrowing = cacheCreates[cacheCreates.length - 1] > cacheCreates[0] * 1.5
    const lowRatio = lastFour[lastFour.length - 1].cacheRatio < 0.5

    if (readVariance < 500 && createGrowing && lowRatio) {
      result.detected = true
      result.cacheInvalidatedAfterResume = true
    }
  }

  return result
}

/**
 * Check if a session contains a compact_boundary record,
 * which indicates it was resumed or continued.
 */
export function hasResumeBoundary(records: SessionRecord[]): boolean {
  return records.some(
    (r) => r.type === 'compact_boundary' || r.type === 'summary'
  )
}
