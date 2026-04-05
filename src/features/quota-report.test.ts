import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { computeTimeAnalysis } from './quota-report.js'

// We test computeTimeAnalysis by creating temp JSONL files
// and redirecting homedir via the HOME env var (os.homedir()
// respects the HOME environment variable on Unix systems).

/**
 * Build an ISO timestamp whose local hour is the given value.
 * This avoids timezone-dependent failures since computeTimeAnalysis
 * uses Date.getHours() (local time) internally.
 */
function localHourToISO(localHour: number, minuteOffset = 0): string {
  const d = new Date()
  d.setHours(localHour, minuteOffset, 0, 0)
  return d.toISOString()
}

describe('computeTimeAnalysis', () => {
  let tempDir: string
  let projectsDir: string
  let origHome: string | undefined

  function makeAssistantRecord(id: string, timestamp: string, tokens: {
    input: number; output: number; cacheRead: number; cacheCreate: number;
  }) {
    return JSON.stringify({
      type: 'assistant',
      uuid: `a-${id}`,
      parentUuid: `u-${id}`,
      sessionId: 's1',
      timestamp,
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        id: `msg_${id}`,
        content: [{ type: 'text', text: 'response' }],
        usage: {
          input_tokens: tokens.input,
          output_tokens: tokens.output,
          cache_creation_input_tokens: tokens.cacheCreate,
          cache_read_input_tokens: tokens.cacheRead,
        },
      },
    })
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clauditor-test-'))
    projectsDir = join(tempDir, '.claude', 'projects', '-test-project')
    mkdirSync(projectsDir, { recursive: true })
    origHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(() => {
    process.env.HOME = origHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('groups tokens by hour correctly', () => {
    // Create a session with turns at different local hours
    const lines = [
      makeAssistantRecord('1', localHourToISO(9), { input: 1000, output: 500, cacheRead: 8000, cacheCreate: 500 }),
      makeAssistantRecord('2', localHourToISO(9, 30), { input: 1000, output: 500, cacheRead: 9000, cacheCreate: 500 }),
      makeAssistantRecord('3', localHourToISO(22), { input: 500, output: 200, cacheRead: 4000, cacheCreate: 300 }),
    ]
    writeFileSync(join(projectsDir, 'test-session.jsonl'), lines.join('\n'))

    const analysis = computeTimeAnalysis(7)

    // Hour 9 should have 2 turns
    const hour9 = analysis.hourly[9]
    expect(hour9.turns).toBe(2)
    expect(hour9.totalTokens).toBe(21000) // (1000+500+8000+500) + (1000+500+9000+500)

    // Hour 22 should have 1 turn
    const hour22 = analysis.hourly[22]
    expect(hour22.turns).toBe(1)
    expect(hour22.totalTokens).toBe(5000)
  })

  it('calculates cache ratio per hour', () => {
    const lines = [
      // High cache hit
      makeAssistantRecord('1', localHourToISO(10), { input: 100, output: 50, cacheRead: 9000, cacheCreate: 100 }),
      // Low cache hit
      makeAssistantRecord('2', localHourToISO(14), { input: 100, output: 50, cacheRead: 1000, cacheCreate: 8000 }),
    ]
    writeFileSync(join(projectsDir, 'test-session.jsonl'), lines.join('\n'))

    const analysis = computeTimeAnalysis(7)

    // Hour 10: cache ratio = 9000 / (100 + 9000 + 100) = 97.8%
    expect(analysis.hourly[10].avgCacheRatio).toBeGreaterThan(0.95)

    // Hour 14: cache ratio = 1000 / (100 + 1000 + 8000) = 11%
    expect(analysis.hourly[14].avgCacheRatio).toBeLessThan(0.15)
  })

  it('deduplicates by message ID', () => {
    // Same message ID in two files — should only count once
    const line = makeAssistantRecord('same', localHourToISO(10), { input: 1000, output: 500, cacheRead: 5000, cacheCreate: 500 })
    writeFileSync(join(projectsDir, 'session-a.jsonl'), line)
    writeFileSync(join(projectsDir, 'session-b.jsonl'), line)

    const analysis = computeTimeAnalysis(7)

    expect(analysis.hourly[10].turns).toBe(1) // not 2
  })
})
