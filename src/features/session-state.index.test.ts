import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Each test needs a fresh module import to pick up the mocked homedir
async function importFresh(tempDir: string) {
  vi.resetModules()
  vi.doMock('node:os', () => ({ homedir: () => tempDir }))
  return await import('./session-state.js')
}

function makeBaseData(overrides: Record<string, unknown> = {}) {
  return {
    savedAt: '2026-04-04 17:00',
    branch: 'main',
    turns: 50,
    tokensPerTurn: 45,
    wasteFactor: 5,
    filesModified: [] as string[],
    cwd: '/home/user/project-a',
    originalTask: null as string | null,
    recentUserMessages: [] as string[],
    gitCommits: [] as string[],
    keyCommands: [] as string[],
    filesRead: [] as string[],
    lastAssistantMessage: null as string | null,
    ...overrides,
  }
}

function readIndex(tempDir: string): Record<string, { path: string; isPostCompact: boolean }> {
  return JSON.parse(readFileSync(join(tempDir, '.clauditor', 'last-session.json'), 'utf-8'))
}

describe('per-project session index', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clauditor-index-'))
  })

  afterEach(() => {
    vi.doUnmock('node:os')
    vi.resetModules()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('records a project entry in last-session.json keyed by cwd', async () => {
    const mod = await importFresh(tempDir)
    mod.saveSessionState(makeBaseData({ cwd: '/home/user/project-a', originalTask: 'Task A' }))

    const index = readIndex(tempDir)
    expect(Object.keys(index)).toEqual(['/home/user/project-a'])
    expect(index['/home/user/project-a'].isPostCompact).toBe(false)
    // Entry points at a real per-project handoff file
    expect(existsSync(index['/home/user/project-a'].path)).toBe(true)
    expect(index['/home/user/project-a'].path).toContain('home-user-project-a')
  })

  it('keeps separate entries for different projects (no last-write-wins clobber)', async () => {
    const mod = await importFresh(tempDir)
    mod.saveSessionState(makeBaseData({ cwd: '/home/user/project-a', originalTask: 'Task A' }))
    mod.saveSessionState(makeBaseData({ cwd: '/home/user/project-b', originalTask: 'Task B' }))

    const index = readIndex(tempDir)
    // Both survive — the whole point of the fix
    expect(Object.keys(index).sort()).toEqual(['/home/user/project-a', '/home/user/project-b'])
    expect(readFileSync(index['/home/user/project-a'].path, 'utf-8')).toContain('Task A')
    expect(readFileSync(index['/home/user/project-b'].path, 'utf-8')).toContain('Task B')
  })

  it('marks PostCompact saves as isPostCompact in the index', async () => {
    const mod = await importFresh(tempDir)
    mod.savePostCompactSummary('Rich summary', '/home/user/project-a')

    const index = readIndex(tempDir)
    expect(index['/home/user/project-a'].isPostCompact).toBe(true)
  })

  it('does NOT leak another project’s handoff via the legacy pointer', async () => {
    const mod = await importFresh(tempDir)

    // Only a legacy pointer exists, and it belongs to project-a.
    const clauditorDir = join(tempDir, '.clauditor')
    mkdirSync(clauditorDir, { recursive: true })
    writeFileSync(
      join(clauditorDir, 'last-session.md'),
      '# Last Session\n\n- **Project:** /home/user/project-a\n\nProject A work',
    )

    // Resolving project-b must not surface project-a's handoff.
    expect(mod.readRecentHandoffs('/home/user/project-b').length).toBe(0)
    // Resolving project-a itself still gets it.
    const own = mod.readRecentHandoffs('/home/user/project-a')
    expect(own.length).toBe(1)
    expect(own[0].content).toContain('Project A work')
  })

  it('still surfaces an unknown-project legacy file as a last resort', async () => {
    const mod = await importFresh(tempDir)

    // Pre-index install: legacy file has no **Project:** line.
    const clauditorDir = join(tempDir, '.clauditor')
    mkdirSync(clauditorDir, { recursive: true })
    writeFileSync(join(clauditorDir, 'last-session.md'), '# Legacy handoff\n\nOld format')

    const handoffs = mod.readRecentHandoffs('/home/user/any-project')
    expect(handoffs.length).toBe(1)
    expect(handoffs[0].content).toContain('Legacy handoff')
  })

  it('resolves a project handoff from the index when the sessions dir is gone', async () => {
    const mod = await importFresh(tempDir)
    const cwd = '/home/user/project-a'

    // Stand-alone handoff file referenced by the index but NOT under the
    // scanned sessions/<encoded-cwd>/ dir (simulates a pruned/moved dir).
    const clauditorDir = join(tempDir, '.clauditor')
    mkdirSync(clauditorDir, { recursive: true })
    const handoffPath = join(clauditorDir, 'orphan-handoff.md')
    writeFileSync(handoffPath, '# Last Session\n\n- **Project:** /home/user/project-a\n\nOrphan body')
    writeFileSync(
      join(clauditorDir, 'last-session.json'),
      JSON.stringify({ [cwd]: { path: handoffPath, savedAt: '2026-04-04', timestamp: Date.now(), isPostCompact: false } }),
    )

    const handoffs = mod.readRecentHandoffs(cwd)
    expect(handoffs.length).toBe(1)
    expect(handoffs[0].content).toContain('Orphan body')
    expect(handoffs[0].project).toBe('/home/user/project-a')
  })

  it('prunes index entries older than the retention window on write', async () => {
    const mod = await importFresh(tempDir)

    // Seed a stale entry (older than 24h) directly.
    const clauditorDir = join(tempDir, '.clauditor')
    mkdirSync(clauditorDir, { recursive: true })
    const staleTs = Date.now() - 25 * 60 * 60 * 1000
    writeFileSync(
      join(clauditorDir, 'last-session.json'),
      JSON.stringify({ '/home/user/old-project': { path: '/gone.md', savedAt: 'x', timestamp: staleTs, isPostCompact: false } }),
    )

    mod.saveSessionState(makeBaseData({ cwd: '/home/user/project-a' }))

    const index = readIndex(tempDir)
    expect(Object.keys(index)).toEqual(['/home/user/project-a'])
  })
})
