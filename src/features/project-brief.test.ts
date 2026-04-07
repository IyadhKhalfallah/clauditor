import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { buildProjectBrief } from './project-brief.js'
import { recordError, recordFix } from './error-index.js'

let tempDir: string
let origHome: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clauditor-brief-'))
  origHome = process.env.HOME || ''
  process.env.HOME = tempDir
})

afterEach(() => {
  process.env.HOME = origHome
  rmSync(tempDir, { recursive: true, force: true })
})

function cwd(label: string): string {
  return `${tempDir}/project-${label}`
}

describe('buildProjectBrief', () => {
  it('returns null or only recent-session when no errors/files exist', () => {
    const brief = buildProjectBrief(cwd('empty'))
    // May include a "Last session" section from real session data
    // but should NOT have "Known errors" or "Active files"
    if (brief) {
      expect(brief).not.toContain('Known errors')
      expect(brief).not.toContain('Active files')
    }
  })

  it('includes errors with confidence tier labels', () => {
    const c = cwd('errors')
    // Record enough errors to create a high-confidence entry
    for (let i = 0; i < 5; i++) {
      recordError(c, 'npm run build', 'Module not found: Cannot resolve @/lib/db')
    }
    recordFix(c, 'npx drizzle-kit push && npm run build')

    const brief = buildProjectBrief(c)
    expect(brief).not.toBeNull()
    expect(brief).toContain('Known errors')
    expect(brief).toContain('npm run build')
    // Should have a confidence tier label
    expect(brief).toMatch(/confirmed|observed|inferred/)
  })

  it('excludes stale errors', () => {
    const c = cwd('stale')
    recordError(c, 'npm test', 'Cannot find module lodash -- this error is long enough')

    // Backdate to make it stale
    const encoded = c.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 100)
    const dir = resolve(tempDir, '.clauditor', 'knowledge', encoded)
    const errors = JSON.parse(
      require('node:fs').readFileSync(resolve(dir, 'errors.json'), 'utf-8')
    )
    const old = new Date()
    old.setDate(old.getDate() - 200)
    errors[0].lastSeen = old.toISOString().slice(0, 10)
    writeFileSync(resolve(dir, 'errors.json'), JSON.stringify(errors))

    const brief = buildProjectBrief(c)
    // The error section should be absent (stale), though brief might have other sections
    if (brief) {
      expect(brief).not.toContain('Known errors')
    }
  })

  it('ranks recent errors above old ones', () => {
    const c = cwd('ranking')
    const encoded = c.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 100)
    const dir = resolve(tempDir, '.clauditor', 'knowledge', encoded)
    mkdirSync(dir, { recursive: true })

    const today = new Date().toISOString().slice(0, 10)
    const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    // Old error with many occurrences (should rank lower due to decay)
    // Recent error with fewer occurrences (should rank higher)
    writeFileSync(
      resolve(dir, 'errors.json'),
      JSON.stringify([
        {
          command: 'npm install',
          error: 'npm ERR! 404 Not Found - old package',
          fix: 'npm install --legacy-peer-deps',
          occurrences: 10,
          firstSeen: twoMonthsAgo,
          lastSeen: twoMonthsAgo,
          lastErrorMs: Date.now() - 60 * 24 * 60 * 60 * 1000,
          confidence: 0.7,
        },
        {
          command: 'npm run build',
          error: 'Module not found: Cannot resolve @/lib/db',
          fix: 'npx drizzle-kit push',
          occurrences: 3,
          firstSeen: today,
          lastSeen: today,
          lastErrorMs: Date.now(),
          confidence: 0.5,
        },
      ])
    )

    const brief = buildProjectBrief(c)!
    expect(brief).not.toBeNull()

    // Recent error should appear before old one
    const buildPos = brief.indexOf('npm run build')
    const installPos = brief.indexOf('npm install')
    expect(buildPos).toBeLessThan(installPos)
  })

  it('stays within character limit', () => {
    const c = cwd('limit')
    // Create many errors to test truncation
    const encoded = c.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 100)
    const dir = resolve(tempDir, '.clauditor', 'knowledge', encoded)
    mkdirSync(dir, { recursive: true })

    const today = new Date().toISOString().slice(0, 10)
    const errors = Array.from({ length: 50 }, (_, i) => ({
      command: `command-${i} with a very long name that takes up space`,
      error: `Error message ${i}: something went wrong with a very detailed description of what happened`,
      fix: `fix-command-${i} --with-flags --and-more-flags --verbose`,
      occurrences: 5,
      firstSeen: today,
      lastSeen: today,
      lastErrorMs: Date.now(),
      confidence: 0.8,
    }))
    writeFileSync(resolve(dir, 'errors.json'), JSON.stringify(errors))

    const brief = buildProjectBrief(c)!
    expect(brief.length).toBeLessThanOrEqual(2003) // 2000 + "..."
  })
})
