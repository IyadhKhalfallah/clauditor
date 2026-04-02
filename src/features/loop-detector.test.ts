import { describe, it, expect } from 'vitest'
import { detectLoop } from './loop-detector.js'
import type { TurnMetrics } from '../types.js'

function makeTurn(turnIndex: number, toolCalls: { name: string; inputHash: string; outputHash: string }[]): TurnMetrics {
  return {
    turnIndex,
    timestamp: `2025-01-01T00:0${turnIndex}:00Z`,
    usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    cacheRatio: 0,
    toolCalls,
  }
}

describe('detectLoop', () => {
  it('returns no loop for fewer than threshold turns', () => {
    const turns = [
      makeTurn(0, [{ name: 'Bash', inputHash: 'aaa', outputHash: 'bbb' }]),
    ]
    const result = detectLoop(turns)
    expect(result.loopDetected).toBe(false)
  })

  it('detects a loop when same tool calls repeat 3+ times', () => {
    const call = { name: 'Bash', inputHash: 'aaa', outputHash: 'bbb' }
    const turns = [
      makeTurn(0, [call]),
      makeTurn(1, [call]),
      makeTurn(2, [call]),
    ]
    const result = detectLoop(turns)
    expect(result.loopDetected).toBe(true)
    expect(result.consecutiveIdenticalTurns).toBe(3)
    expect(result.loopPattern).toContain('Bash')
  })

  it('does not detect a loop with different tool calls', () => {
    const turns = [
      makeTurn(0, [{ name: 'Bash', inputHash: 'aaa', outputHash: 'bbb' }]),
      makeTurn(1, [{ name: 'Bash', inputHash: 'ccc', outputHash: 'ddd' }]),
      makeTurn(2, [{ name: 'Read', inputHash: 'eee', outputHash: 'fff' }]),
    ]
    const result = detectLoop(turns)
    expect(result.loopDetected).toBe(false)
  })

  it('supports custom threshold', () => {
    const call = { name: 'Bash', inputHash: 'aaa', outputHash: 'bbb' }
    const turns = [
      makeTurn(0, [call]),
      makeTurn(1, [call]),
    ]
    const result = detectLoop(turns, 2)
    expect(result.loopDetected).toBe(true)
    expect(result.consecutiveIdenticalTurns).toBe(2)
  })

  it('handles turns with no tool calls', () => {
    const turns = [
      makeTurn(0, []),
      makeTurn(1, []),
      makeTurn(2, []),
    ]
    const result = detectLoop(turns)
    expect(result.loopDetected).toBe(false)
  })
})
