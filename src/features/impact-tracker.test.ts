import { describe, it, expect } from 'vitest'
import { updateImpactFromSessions, type ImpactStats } from './impact-tracker.js'
import type { SessionState } from '../types.js'

const empty: ImpactStats = {
  sessionsMonitored: 0,
  detected: { cacheIssues: 0, loops: 0, resumeAnomalies: 0, contextOverflows: 0 },
  countedSessions: [],
} as unknown as ImpactStats

function session(filePath: string, model: string, contextSize: number): SessionState {
  return {
    filePath,
    model,
    cacheHealth: { degradationDetected: false, status: 'healthy' },
    loopState: { loopDetected: false },
    resumeAnomaly: { detected: false },
    turns: [{
      usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: contextSize },
    }],
  } as unknown as SessionState
}

describe('updateImpactFromSessions context overflows', () => {
  it('does not count a non-Opus 1M session at 300k as an overflow', () => {
    const out = updateImpactFromSessions(empty, [session('a', 'claude-sonnet-4-6', 300_000)])
    expect(out.detected.contextOverflows).toBe(0)
  })

  it('counts a non-Opus session near its 200k limit', () => {
    const out = updateImpactFromSessions(empty, [session('b', 'claude-sonnet-4-6', 190_000)])
    expect(out.detected.contextOverflows).toBe(1)
  })
})
