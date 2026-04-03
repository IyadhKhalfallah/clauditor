import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'

// We test computeTimeAnalysis by creating temp JSONL files
// and pointing the function at them via mocking homedir

describe('computeTimeAnalysis', () => {
  let tempDir: string
  let projectsDir: string

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
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('groups tokens by hour correctly', async () => {
    // Create a session with turns at different hours
    const lines = [
      makeAssistantRecord('1', '2026-04-03T09:00:00Z', { input: 1000, output: 500, cacheRead: 8000, cacheCreate: 500 }),
      makeAssistantRecord('2', '2026-04-03T09:30:00Z', { input: 1000, output: 500, cacheRead: 9000, cacheCreate: 500 }),
      makeAssistantRecord('3', '2026-04-03T22:00:00Z', { input: 500, output: 200, cacheRead: 4000, cacheCreate: 300 }),
    ]
    writeFileSync(join(projectsDir, 'test-session.jsonl'), lines.join('\n'))

    // Import with mocked homedir
    vi.doMock('node:os', () => ({ homedir: () => tempDir }))
    const { computeTimeAnalysis } = await import('./quota-report.js')
    const analysis = computeTimeAnalysis(7)

    // Hour 9 should have 2 turns
    const hour9 = analysis.hourly[9]
    expect(hour9.turns).toBe(2)
    expect(hour9.totalTokens).toBe(21000) // (1000+500+8000+500) + (1000+500+9000+500)

    // Hour 22 should have 1 turn
    const hour22 = analysis.hourly[22]
    expect(hour22.turns).toBe(1)
    expect(hour22.totalTokens).toBe(5000)

    vi.doUnmock('node:os')
  })

  it('calculates cache ratio per hour', async () => {
    const lines = [
      // High cache hit
      makeAssistantRecord('1', '2026-04-03T10:00:00Z', { input: 100, output: 50, cacheRead: 9000, cacheCreate: 100 }),
      // Low cache hit
      makeAssistantRecord('2', '2026-04-03T14:00:00Z', { input: 100, output: 50, cacheRead: 1000, cacheCreate: 8000 }),
    ]
    writeFileSync(join(projectsDir, 'test-session.jsonl'), lines.join('\n'))

    vi.doMock('node:os', () => ({ homedir: () => tempDir }))
    const { computeTimeAnalysis } = await import('./quota-report.js')
    const analysis = computeTimeAnalysis(7)

    // Hour 10: cache ratio = 9000 / (100 + 9000 + 100) = 97.8%
    expect(analysis.hourly[10].avgCacheRatio).toBeGreaterThan(0.95)

    // Hour 14: cache ratio = 1000 / (100 + 1000 + 8000) = 11%
    expect(analysis.hourly[14].avgCacheRatio).toBeLessThan(0.15)

    vi.doUnmock('node:os')
  })

  it('deduplicates by message ID', async () => {
    // Same message ID in two files — should only count once
    const line = makeAssistantRecord('same', '2026-04-03T10:00:00Z', { input: 1000, output: 500, cacheRead: 5000, cacheCreate: 500 })
    writeFileSync(join(projectsDir, 'session-a.jsonl'), line)
    writeFileSync(join(projectsDir, 'session-b.jsonl'), line)

    vi.doMock('node:os', () => ({ homedir: () => tempDir }))
    const { computeTimeAnalysis } = await import('./quota-report.js')
    const analysis = computeTimeAnalysis(7)

    expect(analysis.hourly[10].turns).toBe(1) // not 2

    vi.doUnmock('node:os')
  })
})
