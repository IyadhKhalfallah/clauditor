import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('computeQuotaBrief cache ratio', () => {
  let tempDir: string
  let projectsDir: string

  function makeAssistantRecord(id: string, tokens: {
    input: number; output: number; cacheRead: number; cacheCreate: number;
  }) {
    return JSON.stringify({
      type: 'assistant',
      uuid: `a-${id}`,
      parentUuid: `u-${id}`,
      sessionId: 's1',
      timestamp: new Date().toISOString(),
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
    tempDir = mkdtempSync(join(tmpdir(), 'clauditor-cache-test-'))
    projectsDir = join(tempDir, '.claude', 'projects', '-test-project')
    mkdirSync(projectsDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('computes average cache ratio across sessions', async () => {
    // Session with high cache (90%+ cache reads)
    const lines = Array.from({ length: 5 }, (_, i) =>
      makeAssistantRecord(`t${i}`, { input: 100, output: 50, cacheRead: 9000, cacheCreate: 100 })
    )
    writeFileSync(join(projectsDir, 'high-cache.jsonl'), lines.join('\n'))

    vi.doMock('node:os', () => ({ homedir: () => tempDir }))
    const { computeQuotaBrief } = await import('./quota-report.js')
    const brief = computeQuotaBrief(7)

    expect(brief.totalSessions).toBe(1)
    // cache ratio = 9000 / (100 + 9000 + 100) = 97.8%
    expect(brief.avgCacheRatio).toBeGreaterThan(0.95)
    expect(brief.sessions[0].avgCacheRatio).toBeGreaterThan(0.95)

    vi.doUnmock('node:os')
  })

  it('returns 0 cache ratio when no sessions', async () => {
    vi.doMock('node:os', () => ({ homedir: () => tempDir }))
    // No .claude/projects dir = empty
    const emptyDir = mkdtempSync(join(tmpdir(), 'clauditor-empty-'))
    vi.doMock('node:os', () => ({ homedir: () => emptyDir }))
    const { computeQuotaBrief } = await import('./quota-report.js')
    const brief = computeQuotaBrief(7)

    expect(brief.avgCacheRatio).toBe(0)

    rmSync(emptyDir, { recursive: true, force: true })
    vi.doUnmock('node:os')
  })
})
