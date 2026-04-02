import { describe, it, expect } from 'vitest'
import { detectWorkflowPatterns, generateSkillSuggestions } from './skill-suggest.js'
import type { SessionState, TokenUsage, CacheHealth, LoopState, ResumeAnomaly, QuotaBurnRate } from '../types.js'

function makeSession(label: string, toolCalls: Array<{ name: string; inputHash: string }>): SessionState {
  const usage: TokenUsage = { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 50000 }
  return {
    sessionId: label,
    projectPath: '/test',
    filePath: `/test/${label}.jsonl`,
    model: 'claude-sonnet-4-6',
    label,
    cwd: '/test',
    gitBranch: 'main',
    turns: toolCalls.map((tc, i) => ({
      turnIndex: i,
      timestamp: new Date(Date.now() - (toolCalls.length - i) * 60000).toISOString(),
      usage,
      cacheRatio: 0.95,
      toolCalls: [{ name: tc.name, inputHash: tc.inputHash, outputHash: 'out' }],
    })),
    totalUsage: usage,
    cacheHealth: { status: 'healthy', lastCacheRatio: 0.95, cacheRatioTrend: [0.95], degradationDetected: false } as CacheHealth,
    loopState: { loopDetected: false, consecutiveIdenticalTurns: 0 } as LoopState,
    resumeAnomaly: { detected: false, resumeDetected: false, outputTokenSpike: null, cacheInvalidatedAfterResume: false } as ResumeAnomaly,
    quotaBurnRate: { tokensPerMinute: 5000, estimatedMinutesRemaining: null, burnRateStatus: 'normal' } as QuotaBurnRate,
    lastUpdated: new Date(),
  }
}

describe('detectWorkflowPatterns', () => {
  it('returns empty for insufficient sessions', () => {
    const sessions = [
      makeSession('s1', [{ name: 'Bash', inputHash: 'abc' }, { name: 'Edit', inputHash: 'def' }]),
    ]
    expect(detectWorkflowPatterns(sessions)).toEqual([])
  })

  it('detects a repeating bash workflow across 3 sessions', () => {
    // Same Bash command sequence in 3 sessions
    const calls = [
      { name: 'Bash', inputHash: 'test123' },
      { name: 'Edit', inputHash: 'fix456' },
      { name: 'Bash', inputHash: 'test123' },
    ]
    const sessions = [
      makeSession('s1', calls),
      makeSession('s2', calls),
      makeSession('s3', calls),
    ]

    const patterns = detectWorkflowPatterns(sessions)
    expect(patterns.length).toBeGreaterThan(0)
    expect(patterns[0].sessionCount).toBe(3)
  })

  it('does not detect patterns that appear in only 2 sessions', () => {
    const calls = [
      { name: 'Bash', inputHash: 'unique1' },
      { name: 'Edit', inputHash: 'unique2' },
    ]
    const sessions = [
      makeSession('s1', calls),
      makeSession('s2', calls),
      makeSession('s3', [{ name: 'Read', inputHash: 'different' }, { name: 'Grep', inputHash: 'other' }]),
    ]

    const patterns = detectWorkflowPatterns(sessions)
    // The 2-session pattern shouldn't appear
    const twoSessionPatterns = patterns.filter((p) => p.sessionCount < 3)
    expect(twoSessionPatterns).toEqual([])
  })
})

describe('generateSkillSuggestions', () => {
  it('generates suggestions with prompts', () => {
    const calls = [
      { name: 'Bash', inputHash: 'test123' },
      { name: 'Edit', inputHash: 'fix456' },
      { name: 'Bash', inputHash: 'test123' },
    ]
    const sessions = [
      makeSession('s1', calls),
      makeSession('s2', calls),
      makeSession('s3', calls),
    ]

    const patterns = detectWorkflowPatterns(sessions)
    const suggestions = generateSkillSuggestions(patterns)

    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions[0].name).toBeTruthy()
    expect(suggestions[0].prompt).toContain('skill suggestion')
    expect(suggestions[0].prompt).toContain('.claude/skills/')
  })
})
