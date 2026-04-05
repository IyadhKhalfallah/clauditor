import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Each test needs a fresh module import to pick up the mocked homedir
async function importFresh(tempDir: string) {
  vi.resetModules()
  vi.doMock('node:os', () => ({ homedir: () => tempDir }))
  return await import('./calibration.js')
}

/** Build an assistant JSONL record with the given token usage */
function makeAssistantRecord(
  id: string,
  sessionId: string,
  tokens: {
    input: number
    output: number
    cacheCreate?: number
    cacheRead?: number
  }
) {
  return JSON.stringify({
    type: 'assistant',
    uuid: `a-${id}`,
    sessionId,
    timestamp: '2026-04-03T10:00:00Z',
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: tokens.input,
        output_tokens: tokens.output,
        cache_creation_input_tokens: tokens.cacheCreate ?? 0,
        cache_read_input_tokens: tokens.cacheRead ?? 0,
      },
    },
  })
}

/**
 * Write a JSONL session file with the given per-turn token arrays.
 * Each element is the total tokens for that turn (split as input + output).
 */
function writeSessionFile(
  dir: string,
  filename: string,
  turnTokens: number[]
) {
  const lines = turnTokens.map((total, i) =>
    makeAssistantRecord(`${i}`, 's1', {
      input: Math.floor(total * 0.7),
      output: Math.floor(total * 0.3),
    })
  )
  const filePath = join(dir, filename)
  writeFileSync(filePath, lines.join('\n'))
  return filePath
}

/**
 * Create a projects directory structure under tempDir with session files.
 * Returns the project directory path.
 */
function setupProjectDir(tempDir: string, projectName: string): string {
  const projectDir = join(tempDir, '.claude', 'projects', projectName)
  mkdirSync(projectDir, { recursive: true })
  return projectDir
}

describe('loadCalibration', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clauditor-cal-load-'))
  })

  afterEach(() => {
    vi.doUnmock('node:os')
    vi.resetModules()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns conservative defaults when no calibration file exists', async () => {
    const mod = await importFresh(tempDir)
    const result = mod.loadCalibration()

    expect(result.wasteThreshold).toBe(10)
    expect(result.minTurns).toBe(30)
    expect(result.confident).toBe(false)
    expect(result.sessionsAnalyzed).toBe(0)
    expect(result.sessionProfiles).toEqual([])
  })

  it('loads saved calibration data from file', async () => {
    const clauditorDir = join(tempDir, '.clauditor')
    mkdirSync(clauditorDir, { recursive: true })
    writeFileSync(
      join(clauditorDir, 'calibration.json'),
      JSON.stringify({
        calibratedAt: '2026-04-01T00:00:00Z',
        sessionsAnalyzed: 15,
        wasteThreshold: 7,
        minTurns: 40,
        confident: true,
        sessionProfiles: [],
      })
    )

    const mod = await importFresh(tempDir)
    const result = mod.loadCalibration()

    expect(result.wasteThreshold).toBe(7)
    expect(result.minTurns).toBe(40)
    expect(result.confident).toBe(true)
    expect(result.sessionsAnalyzed).toBe(15)
  })

  it('returns defaults on corrupt/invalid JSON file', async () => {
    const clauditorDir = join(tempDir, '.clauditor')
    mkdirSync(clauditorDir, { recursive: true })
    writeFileSync(join(clauditorDir, 'calibration.json'), 'not-json{{{')

    const mod = await importFresh(tempDir)
    const result = mod.loadCalibration()

    expect(result.wasteThreshold).toBe(10)
    expect(result.minTurns).toBe(30)
    expect(result.confident).toBe(false)
  })
})

describe('calibrate', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clauditor-cal-'))
  })

  afterEach(() => {
    vi.doUnmock('node:os')
    vi.resetModules()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns conservative defaults when no sessions exist', async () => {
    // No .claude/projects directory at all
    const mod = await importFresh(tempDir)
    const result = mod.calibrate()

    expect(result.wasteThreshold).toBe(10)
    expect(result.minTurns).toBe(30)
    expect(result.confident).toBe(false)
  })

  it('returns conservative defaults when no session files exist', async () => {
    // Empty projects directory
    setupProjectDir(tempDir, 'empty-project')

    const mod = await importFresh(tempDir)
    const result = mod.calibrate()

    expect(result.wasteThreshold).toBe(10)
    expect(result.minTurns).toBe(30)
    expect(result.confident).toBe(false)
  })

  it('returns conservative defaults when fewer than 3 significant sessions', async () => {
    const projDir = setupProjectDir(tempDir, 'test-project')

    // 2 sessions with 30+ turns (significant) + 1 short session (ignored)
    const stableTurns = Array.from({ length: 35 }, () => 1000)
    writeSessionFile(projDir, 'session1.jsonl', stableTurns)
    writeSessionFile(projDir, 'session2.jsonl', stableTurns)
    writeSessionFile(projDir, 'short.jsonl', Array.from({ length: 5 }, () => 1000))

    const mod = await importFresh(tempDir)
    const result = mod.calibrate()

    expect(result.wasteThreshold).toBe(10)
    expect(result.minTurns).toBe(30)
    expect(result.confident).toBe(false)
    // Still analyzed all valid sessions (those with 10+ turns)
    expect(result.sessionsAnalyzed).toBe(2)
  })

  it('skips sessions with fewer than 10 turns', async () => {
    const projDir = setupProjectDir(tempDir, 'test-project')

    // 9 turns - should be skipped by analyzeSession
    writeSessionFile(projDir, 'tiny.jsonl', Array.from({ length: 9 }, () => 1000))

    const mod = await importFresh(tempDir)
    const result = mod.calibrate()

    // No profiles at all since the only session was too short
    expect(result.sessionsAnalyzed).toBe(0)
  })

  it('skips agent- prefixed files', async () => {
    const projDir = setupProjectDir(tempDir, 'test-project')

    // Agent file that would otherwise qualify
    writeSessionFile(projDir, 'agent-sub.jsonl', Array.from({ length: 40 }, () => 1000))

    const mod = await importFresh(tempDir)
    const result = mod.calibrate()

    expect(result.sessionsAnalyzed).toBe(0)
  })

  it('computes waste threshold from break-even waste factors with enough data', async () => {
    const projDir = setupProjectDir(tempDir, 'test-project')

    // Create 5+ sessions with 30+ turns that have growing token usage
    // to produce break-even points
    for (let s = 0; s < 6; s++) {
      // Tokens grow significantly: baseline ~1000, final ~8000 (8x waste)
      const turns = Array.from({ length: 50 }, (_, i) => {
        const growth = 1 + (i / 50) * 7 // 1x to 8x
        return Math.round(1000 * growth)
      })
      writeSessionFile(projDir, `session${s}.jsonl`, turns)
    }

    const mod = await importFresh(tempDir)
    const result = mod.calibrate()

    expect(result.sessionsAnalyzed).toBe(6)
    expect(result.confident).toBe(true)
    // Threshold should be clamped between 5 and 15
    expect(result.wasteThreshold).toBeGreaterThanOrEqual(5)
    expect(result.wasteThreshold).toBeLessThanOrEqual(15)
  })

  it('clamps threshold to 5-15 range', async () => {
    const projDir = setupProjectDir(tempDir, 'test-project')

    // Create sessions with very low waste factor break-even (e.g., 1.5x)
    // This should result in a low threshold, clamped to minimum 5
    for (let s = 0; s < 6; s++) {
      // Very mild growth: 1x to 1.8x
      const turns = Array.from({ length: 50 }, (_, i) => {
        const growth = 1 + (i / 50) * 0.8
        return Math.round(1000 * growth)
      })
      writeSessionFile(projDir, `session${s}.jsonl`, turns)
    }

    const mod = await importFresh(tempDir)
    const result = mod.calibrate()

    // If break-even wastes are found, threshold is clamped to at least 5
    expect(result.wasteThreshold).toBeGreaterThanOrEqual(5)
    expect(result.wasteThreshold).toBeLessThanOrEqual(15)
  })

  it('handles sessions with no break-even point (all null)', async () => {
    const projDir = setupProjectDir(tempDir, 'test-project')

    // Create sessions with flat (no growth) token usage
    // These won't have break-even points
    for (let s = 0; s < 4; s++) {
      const turns = Array.from({ length: 40 }, () => 1000) // constant
      writeSessionFile(projDir, `session${s}.jsonl`, turns)
    }

    const mod = await importFresh(tempDir)
    const result = mod.calibrate()

    // With no break-even wastes, the fallback || 10 kicks in
    expect(result.wasteThreshold).toBe(10)
    expect(result.sessionsAnalyzed).toBe(4)
  })

  it('computes minTurns from sessions that reached 2x waste', async () => {
    const projDir = setupProjectDir(tempDir, 'test-project')

    // Sessions with significant growth to reach 2x+ waste
    for (let s = 0; s < 5; s++) {
      const turns = Array.from({ length: 60 }, (_, i) => {
        // Growth from 1x to 5x over 60 turns
        const growth = 1 + (i / 60) * 4
        return Math.round(1000 * growth)
      })
      writeSessionFile(projDir, `session${s}.jsonl`, turns)
    }

    const mod = await importFresh(tempDir)
    const result = mod.calibrate()

    // minTurns should be clamped between 20 and 100
    expect(result.minTurns).toBeGreaterThanOrEqual(20)
    expect(result.minTurns).toBeLessThanOrEqual(100)
  })

  it('defaults minTurns to 30 when no sessions reach 2x waste', async () => {
    const projDir = setupProjectDir(tempDir, 'test-project')

    // Sessions with very mild growth (< 2x waste factor)
    for (let s = 0; s < 4; s++) {
      const turns = Array.from({ length: 40 }, (_, i) => {
        // Growth from 1x to 1.5x
        const growth = 1 + (i / 40) * 0.5
        return Math.round(1000 * growth)
      })
      writeSessionFile(projDir, `session${s}.jsonl`, turns)
    }

    const mod = await importFresh(tempDir)
    const result = mod.calibrate()

    expect(result.minTurns).toBe(30)
  })

  it('saves calibration to disk', async () => {
    const projDir = setupProjectDir(tempDir, 'test-project')

    for (let s = 0; s < 4; s++) {
      writeSessionFile(
        projDir,
        `session${s}.jsonl`,
        Array.from({ length: 40 }, () => 1000)
      )
    }

    const mod = await importFresh(tempDir)
    mod.calibrate()

    // Verify the calibration file was written
    const { readFileSync } = await import('node:fs')
    const calPath = join(tempDir, '.clauditor', 'calibration.json')
    const saved = JSON.parse(readFileSync(calPath, 'utf-8'))
    expect(saved.sessionsAnalyzed).toBe(4)
    expect(saved.wasteThreshold).toBeGreaterThanOrEqual(5)
  })

  it('computes waste factor correctly (final / baseline)', async () => {
    const projDir = setupProjectDir(tempDir, 'test-project')

    // 15 turns: first 5 at 1000, last 5 at 5000 -> wasteFactor = 5.0
    const turns = [
      ...Array.from({ length: 5 }, () => 1000),
      ...Array.from({ length: 5 }, () => 3000),
      ...Array.from({ length: 5 }, () => 5000),
    ]
    writeSessionFile(projDir, 'session.jsonl', turns)

    const mod = await importFresh(tempDir)
    const result = mod.calibrate()

    expect(result.sessionsAnalyzed).toBe(1)
    const profile = result.sessionProfiles[0]
    expect(profile.wasteFactor).toBe(5)
    expect(profile.turns).toBe(15)
  })
})

describe('formatCalibration', () => {
  it('formats calibration data with threshold and data points', async () => {
    const mod = await importFresh(tmpdir())
    const cal: ReturnType<typeof mod.loadCalibration> = {
      calibratedAt: '2026-04-01T12:30:00Z',
      sessionsAnalyzed: 10,
      wasteThreshold: 8,
      minTurns: 35,
      confident: true,
      sessionProfiles: [
        {
          turns: 60,
          baseline: 5000,
          final: 40000,
          wasteFactor: 8,
          breakEvenTurn: 25,
          breakEvenWaste: 3.5,
        },
      ],
    }

    const output = mod.formatCalibration(cal)

    expect(output).toContain('clauditor calibration')
    expect(output).toContain('Sessions analyzed: 10')
    expect(output).toContain('high (10+ data points)')
    expect(output).toContain('Waste factor: 8x')
    expect(output).toContain('Min turns: 35')
    expect(output).toContain('60 turns')
    expect(output).toContain('break-even at turn 25')
  })

  it('shows low confidence when not confident', async () => {
    const mod = await importFresh(tmpdir())
    const cal: ReturnType<typeof mod.loadCalibration> = {
      calibratedAt: '2026-04-01T12:30:00Z',
      sessionsAnalyzed: 2,
      wasteThreshold: 10,
      minTurns: 30,
      confident: false,
      sessionProfiles: [],
    }

    const output = mod.formatCalibration(cal)

    expect(output).toContain('low (using conservative defaults)')
  })

  it('handles empty session profiles', async () => {
    const mod = await importFresh(tmpdir())
    const cal: ReturnType<typeof mod.loadCalibration> = {
      calibratedAt: '2026-04-01T12:30:00Z',
      sessionsAnalyzed: 0,
      wasteThreshold: 10,
      minTurns: 30,
      confident: false,
      sessionProfiles: [],
    }

    const output = mod.formatCalibration(cal)

    expect(output).toContain('clauditor calibration')
    expect(output).not.toContain('DATA POINTS')
  })
})
