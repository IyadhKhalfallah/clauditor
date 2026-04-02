import type { LoopState, TurnMetrics, ToolCallSummary } from '../types.js'

/**
 * Detect compaction loops by checking for repeated identical tool calls.
 *
 * A loop is detected when the same sequence of (tool name + input hash + output hash)
 * appears consecutively for `threshold` or more turns.
 */
export function detectLoop(
  turns: TurnMetrics[],
  threshold: number = 3
): LoopState {
  if (turns.length < threshold) {
    return {
      loopDetected: false,
      consecutiveIdenticalTurns: 0,
    }
  }

  // Check the last N turns for identical tool call patterns
  const recentTurns = turns.slice(-threshold - 1)
  let consecutiveCount = 1
  let loopPattern: string | undefined

  for (let i = recentTurns.length - 1; i > 0; i--) {
    const current = fingerprint(recentTurns[i].toolCalls)
    const previous = fingerprint(recentTurns[i - 1].toolCalls)

    if (current && current === previous) {
      consecutiveCount++
      if (!loopPattern) {
        loopPattern = describeToolCalls(recentTurns[i].toolCalls)
      }
    } else {
      break
    }
  }

  return {
    loopDetected: consecutiveCount >= threshold,
    consecutiveIdenticalTurns: consecutiveCount,
    loopPattern:
      consecutiveCount >= threshold ? loopPattern : undefined,
  }
}

/**
 * Create a fingerprint of a turn's tool calls for comparison.
 */
function fingerprint(toolCalls: ToolCallSummary[]): string {
  if (toolCalls.length === 0) return ''
  return toolCalls
    .map((tc) => `${tc.name}:${tc.inputHash}:${tc.outputHash}`)
    .join('|')
}

/**
 * Create a human-readable description of tool calls.
 */
function describeToolCalls(toolCalls: ToolCallSummary[]): string {
  if (toolCalls.length === 0) return 'empty turn'
  if (toolCalls.length === 1) return `${toolCalls[0].name} call`
  const names = [...new Set(toolCalls.map((tc) => tc.name))]
  return `${names.join(' + ')} calls`
}
