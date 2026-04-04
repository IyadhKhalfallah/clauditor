import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
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

describe('per-session handoff storage', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clauditor-persession-'))
  })

  afterEach(() => {
    vi.doUnmock('node:os')
    vi.resetModules()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('creates timestamped .md files in sessions/<encoded-cwd>/', async () => {
    const mod = await importFresh(tempDir)

    mod.saveSessionState(makeBaseData({
      originalTask: 'Build REST API',
      gitCommits: ['feat: add pagination'],
      lastAssistantMessage: 'Next: deploy',
    }))

    const sessionsDir = join(tempDir, '.clauditor', 'sessions')
    const cwdDirs = readdirSync(sessionsDir)
    expect(cwdDirs.length).toBe(1)
    expect(cwdDirs[0]).toContain('home-user-project-a')

    const files = readdirSync(join(sessionsDir, cwdDirs[0]))
    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/^\d+\.md$/)

    const content = readFileSync(join(sessionsDir, cwdDirs[0], files[0]), 'utf-8')
    expect(content).toContain('Build REST API')
    expect(content).toContain('feat: add pagination')
    expect(content).toContain('Next: deploy')
  })

  it('creates separate files for different sessions in same project', async () => {
    const mod = await importFresh(tempDir)

    mod.saveSessionState(makeBaseData({ originalTask: 'Task A' }))
    await new Promise(r => setTimeout(r, 15))
    mod.saveSessionState(makeBaseData({ originalTask: 'Task B' }))

    const sessionsDir = join(tempDir, '.clauditor', 'sessions')
    const cwdDirs = readdirSync(sessionsDir)
    const files = readdirSync(join(sessionsDir, cwdDirs[0]))
    expect(files.length).toBe(2)
  })

  it('saves PostCompact summary as per-session file', async () => {
    const mod = await importFresh(tempDir)

    mod.savePostCompactSummary('JWT validation blocker', '/home/user/project-a')

    const sessionsDir = join(tempDir, '.clauditor', 'sessions')
    const cwdDirs = readdirSync(sessionsDir)
    const files = readdirSync(join(sessionsDir, cwdDirs[0]))
    const content = readFileSync(join(sessionsDir, cwdDirs[0], files[0]), 'utf-8')

    expect(content).toContain('PostCompact')
    expect(content).toContain('JWT validation')
  })

  it('returns handoffs sorted most recent first', async () => {
    const mod = await importFresh(tempDir)
    const cwd = '/home/user/project-a'

    mod.saveSessionState(makeBaseData({ cwd, originalTask: 'Older task' }))
    await new Promise(r => setTimeout(r, 15))
    mod.savePostCompactSummary('Newer task', cwd)

    const handoffs = mod.readRecentHandoffs(cwd)
    expect(handoffs.length).toBe(2)
    expect(handoffs[0].content).toContain('Newer task')
    expect(handoffs[0].isPostCompact).toBe(true)
    expect(handoffs[1].content).toContain('Older task')
    expect(handoffs[1].isPostCompact).toBe(false)
  })

  it('returns empty array when no handoffs exist', async () => {
    const mod = await importFresh(tempDir)
    const handoffs = mod.readRecentHandoffs('/home/user/nonexistent')
    expect(handoffs.length).toBe(0)
  })

  it('cleans up files older than 24h', async () => {
    const mod = await importFresh(tempDir)
    const cwd = '/home/user/project-a'
    const encodedCwd = cwd.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 100)
    const dir = join(tempDir, '.clauditor', 'sessions', encodedCwd)
    mkdirSync(dir, { recursive: true })

    // Old file (25h ago)
    const oldTs = Date.now() - 25 * 60 * 60 * 1000
    writeFileSync(join(dir, `${oldTs}.md`), '# Old session')

    // Recent file
    const recentTs = Date.now()
    writeFileSync(join(dir, `${recentTs}.md`), '# Recent session')

    const handoffs = mod.readRecentHandoffs(cwd)
    expect(handoffs.length).toBe(1)
    expect(handoffs[0].content).toContain('Recent session')

    // Old file should be deleted
    const remaining = readdirSync(dir)
    expect(remaining.length).toBe(1)
  })

  it('falls back to legacy file when no per-session files exist', async () => {
    const mod = await importFresh(tempDir)

    // Only write legacy file, no sessions dir
    const clauditorDir = join(tempDir, '.clauditor')
    mkdirSync(clauditorDir, { recursive: true })
    writeFileSync(join(clauditorDir, 'last-session.md'), '# Legacy handoff\n\nOld format')

    const handoffs = mod.readRecentHandoffs('/home/user/any-project')
    expect(handoffs.length).toBe(1)
    expect(handoffs[0].content).toContain('Legacy handoff')
  })

  it('isolates handoffs by project (cwd)', async () => {
    const mod = await importFresh(tempDir)

    mod.saveSessionState(makeBaseData({ cwd: '/home/user/project-a', originalTask: 'Project A task' }))
    mod.saveSessionState(makeBaseData({ cwd: '/home/user/project-b', originalTask: 'Project B task' }))

    const handoffsA = mod.readRecentHandoffs('/home/user/project-a')
    expect(handoffsA.length).toBe(1)
    expect(handoffsA[0].content).toContain('Project A task')

    const handoffsB = mod.readRecentHandoffs('/home/user/project-b')
    expect(handoffsB.length).toBe(1)
    expect(handoffsB[0].content).toContain('Project B task')
  })

  it('marks PostCompact files vs mechanical extraction correctly', async () => {
    const mod = await importFresh(tempDir)
    const cwd = '/home/user/project'

    mod.saveSessionState(makeBaseData({ cwd, originalTask: 'Mechanical' }))
    await new Promise(r => setTimeout(r, 15))
    mod.savePostCompactSummary('Claude rich summary', cwd)

    const handoffs = mod.readRecentHandoffs(cwd)
    expect(handoffs.length).toBe(2)

    const postCompact = handoffs.find(h => h.isPostCompact)
    const mechanical = handoffs.find(h => !h.isPostCompact)
    expect(postCompact).toBeDefined()
    expect(postCompact!.content).toContain('Claude rich summary')
    expect(mechanical).toBeDefined()
    expect(mechanical!.content).toContain('Mechanical')
  })

  it('also writes legacy file for backward compatibility', async () => {
    const mod = await importFresh(tempDir)

    mod.saveSessionState(makeBaseData({ originalTask: 'Latest task' }))

    const legacy = readFileSync(join(tempDir, '.clauditor', 'last-session.md'), 'utf-8')
    expect(legacy).toContain('Latest task')
  })
})
