import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  recordError, recordFix, findKnownError, readErrorIndex,
  extractBaseCommand, cleanupErrorIndex, effectiveConfidence,
  confidenceTier, isNoiseError, recordOutcome, runLocalDecayPass,
} from './error-index.js'

let tempDir: string
let origHome: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clauditor-ei-'))
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

// ─── extractBaseCommand ─────────────────────────────────────

describe('extractBaseCommand', () => {
  it('extracts binary name', () => {
    expect(extractBaseCommand('dotnet build')).toBe('dotnet')
    expect(extractBaseCommand('npm test')).toBe('npm')
    expect(extractBaseCommand('NODE_ENV=test npm test')).toBe('npm')
    expect(extractBaseCommand('sudo dotnet build')).toBe('dotnet')
    expect(extractBaseCommand('npx vitest run')).toBe('vitest')
  })
})

// ─── effectiveConfidence ────────────────────────────────────

describe('effectiveConfidence', () => {
  it('returns base confidence for today', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(effectiveConfidence(0.8, today)).toBeCloseTo(0.8, 1)
  })

  it('decays to ~half after 45 days', () => {
    const d = new Date()
    d.setDate(d.getDate() - 45)
    const eff = effectiveConfidence(1.0, d.toISOString().slice(0, 10))
    expect(eff).toBeCloseTo(0.5, 1)
  })

  it('decays to ~quarter after 90 days', () => {
    const d = new Date()
    d.setDate(d.getDate() - 90)
    const eff = effectiveConfidence(1.0, d.toISOString().slice(0, 10))
    expect(eff).toBeCloseTo(0.25, 1)
  })

  it('never goes below MIN_CONFIDENCE', () => {
    const d = new Date()
    d.setDate(d.getDate() - 365)
    const eff = effectiveConfidence(0.3, d.toISOString().slice(0, 10))
    expect(eff).toBeGreaterThanOrEqual(0.05)
  })

  it('handles invalid date gracefully', () => {
    expect(effectiveConfidence(0.5, 'not-a-date')).toBe(0.5)
  })
})

// ─── confidenceTier ─────────────────────────────────────────

describe('confidenceTier', () => {
  it('returns confirmed for >= 0.7', () => {
    expect(confidenceTier(0.7)).toBe('confirmed')
    expect(confidenceTier(1.0)).toBe('confirmed')
  })

  it('returns observed for 0.4-0.69', () => {
    expect(confidenceTier(0.4)).toBe('observed')
    expect(confidenceTier(0.69)).toBe('observed')
  })

  it('returns inferred for 0.2-0.39', () => {
    expect(confidenceTier(0.2)).toBe('inferred')
    expect(confidenceTier(0.39)).toBe('inferred')
  })

  it('returns stale for < 0.2', () => {
    expect(confidenceTier(0.19)).toBe('stale')
    expect(confidenceTier(0.0)).toBe('stale')
  })
})

// ─── isNoiseError ───────────────────────────────────────────

describe('isNoiseError', () => {
  it('filters "command not found"', () => {
    expect(isNoiseError('zsh: command not found: blahblah')).toBe(true)
  })

  it('filters "Unknown command"', () => {
    expect(isNoiseError('Unknown command: "blahblah"')).toBe(true)
  })

  it('filters short errors', () => {
    expect(isNoiseError('error')).toBe(true)
    expect(isNoiseError('fail')).toBe(true)
  })

  it('filters transient network errors', () => {
    expect(isNoiseError('connect ETIMEDOUT 192.168.1.1:443')).toBe(true)
    expect(isNoiseError('read ECONNRESET')).toBe(true)
  })

  it('passes real errors through', () => {
    expect(isNoiseError('error TS2322: Type string is not assignable to type number')).toBe(false)
    expect(isNoiseError('Module not found: Cannot resolve @/lib/db')).toBe(false)
    expect(isNoiseError('npm ERR! 404 Not Found - GET https://registry.npmjs.org/nonexistent')).toBe(false)
  })
})

// ─── recordError ────────────────────────────────────────────

describe('recordError', () => {
  it('records a new error with initial confidence 0.3', () => {
    const c = cwd('new')
    recordError(c, 'dotnet build', 'error NETSDK1004: Assets file not found')
    const errors = readErrorIndex(c)
    expect(errors.length).toBe(1)
    expect(errors[0].occurrences).toBe(1)
    expect(errors[0].confidence).toBe(0.3)
    expect(errors[0].fix).toBeNull()
  })

  it('increments occurrences and boosts confidence for same error', () => {
    const c = cwd('incr')
    recordError(c, 'dotnet build', 'error NETSDK1004: Assets file not found')
    recordError(c, 'dotnet build', 'error NETSDK1004: Assets file not found')
    recordError(c, 'dotnet build --no-restore', 'error NETSDK1004: Assets file not found')
    const errors = readErrorIndex(c)
    expect(errors.length).toBe(1)
    expect(errors[0].occurrences).toBe(3)
    expect(errors[0].confidence).toBeCloseTo(0.4, 10) // 0.3 + 0.05 + 0.05
  })

  it('records different errors separately', () => {
    const c = cwd('diff')
    recordError(c, 'dotnet build', 'error NETSDK1004')
    recordError(c, 'npm test', 'Cannot find module lodash')
    expect(readErrorIndex(c).length).toBe(2)
  })

  it('skips noise errors', () => {
    const c = cwd('noise')
    recordError(c, 'blahblah', 'command not found: blahblah')
    recordError(c, 'npm xyz', 'Unknown command: "xyz"')
    recordError(c, 'cmd', 'err') // too short
    expect(readErrorIndex(c).length).toBe(0)
  })
})

// ─── recordFix ──────────────────────────────────────────────

describe('recordFix', () => {
  it('records a fix and boosts confidence', () => {
    const c = cwd('fix')
    recordError(c, 'dotnet build', 'error NETSDK1004: Assets file not found')
    recordFix(c, 'dotnet build --no-restore')
    const errors = readErrorIndex(c)
    expect(errors[0].fix).toBe('dotnet build --no-restore')
    expect(errors[0].confidence).toBeCloseTo(0.45, 10) // 0.3 + 0.15
  })

  it('does nothing when no matching error', () => {
    const c = cwd('nofix')
    recordFix(c, 'npm test')
    expect(readErrorIndex(c).length).toBe(0)
  })
})

// ─── recordOutcome ──────────────────────────────────────────

describe('recordOutcome', () => {
  it('boosts confidence on positive outcome', () => {
    const c = cwd('outcome-pos')
    recordError(c, 'npm run build', 'Module not found: @/lib/db')
    recordError(c, 'npm run build', 'Module not found: @/lib/db')
    recordFix(c, 'npm run build')

    const before = readErrorIndex(c)[0].confidence
    recordOutcome(c, 'npm run build', 'positive')
    const after = readErrorIndex(c)[0].confidence
    expect(after).toBeGreaterThan(before)
    expect(after - before).toBeCloseTo(0.1, 2)
  })

  it('decreases confidence on negative outcome', () => {
    const c = cwd('outcome-neg')
    recordError(c, 'npm run build', 'Module not found: @/lib/db')
    recordError(c, 'npm run build', 'Module not found: @/lib/db')
    recordFix(c, 'npm run build')

    const before = readErrorIndex(c)[0].confidence
    recordOutcome(c, 'npm run build', 'negative')
    const after = readErrorIndex(c)[0].confidence
    expect(after).toBeLessThan(before)
  })

  it('does nothing for unknown command', () => {
    const c = cwd('outcome-unknown')
    recordOutcome(c, 'cargo build', 'positive')
    expect(readErrorIndex(c).length).toBe(0)
  })

  it('confidence never goes below minimum', () => {
    const c = cwd('outcome-floor')
    recordError(c, 'npm test', 'Cannot find module lodash')
    recordFix(c, 'npm install lodash')
    // Hammer negative outcomes
    for (let i = 0; i < 20; i++) {
      recordOutcome(c, 'npm test', 'negative')
    }
    expect(readErrorIndex(c)[0].confidence).toBeGreaterThanOrEqual(0.05)
  })
})

// ─── findKnownError ─────────────────────────────────────────

describe('findKnownError', () => {
  it('finds errors with fix using effective confidence', () => {
    const c = cwd('find1')
    recordError(c, 'dotnet build', 'error NETSDK1004: Assets file not found')
    recordError(c, 'dotnet build', 'error NETSDK1004: Assets file not found')
    recordFix(c, 'dotnet build --no-restore')
    const found = findKnownError(c, 'dotnet build')
    expect(found).not.toBeNull()
    expect(found!.fix).toBe('dotnet build --no-restore')
  })

  it('returns null for stale errors', () => {
    const c = cwd('stale')
    recordError(c, 'npm test', 'Cannot find module lodash')
    recordError(c, 'npm test', 'Cannot find module lodash')

    // Backdate to make it stale
    const errors = readErrorIndex(c)
    const old = new Date()
    old.setDate(old.getDate() - 200)
    errors[0].lastSeen = old.toISOString().slice(0, 10)
    errors[0].confidence = 0.3

    const encoded = c.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 100)
    const dir = resolve(tempDir, '.clauditor', 'knowledge', encoded)
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, 'errors.json'), JSON.stringify(errors))

    // After 200 days with 0.3 confidence: 0.3 * 0.5^(200/45) ≈ 0.008 — below 0.2
    expect(findKnownError(c, 'npm test')).toBeNull()
  })

  it('returns null for unknown commands', () => {
    const c = cwd('unknown')
    expect(findKnownError(c, 'cargo build')).toBeNull()
  })

  it('prefers entries with fix over those without', () => {
    const c = cwd('prefer-fix')
    // Record error without fix (high occurrences)
    for (let i = 0; i < 5; i++) {
      recordError(c, 'npm test', 'Cannot find module lodash')
    }
    // Record same base cmd error with fix
    recordError(c, 'npm install', 'npm ERR! 404 Not Found')
    recordError(c, 'npm install', 'npm ERR! 404 Not Found')
    recordFix(c, 'npm install --registry=https://registry.npmjs.org/')

    const found = findKnownError(c, 'npm test')
    // Should find the one with fix even though the other has more occurrences
    expect(found).not.toBeNull()
    expect(found!.fix).not.toBeNull()
  })
})

// ─── runLocalDecayPass ──────────────────────────────────────

describe('runLocalDecayPass', () => {
  it('archives entries below decay threshold', () => {
    const c = cwd('decay')
    recordError(c, 'npm test', 'Cannot find module lodash')

    // Backdate to very old
    const errors = readErrorIndex(c)
    const old = new Date()
    old.setDate(old.getDate() - 300)
    errors[0].lastSeen = old.toISOString().slice(0, 10)

    const encoded = c.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 100)
    const dir = resolve(tempDir, '.clauditor', 'knowledge', encoded)
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, 'errors.json'), JSON.stringify(errors))

    const archived = runLocalDecayPass(c)
    expect(archived).toBe(1)
    expect(readErrorIndex(c).length).toBe(0)
  })

  it('keeps recent entries', () => {
    const c = cwd('keep')
    recordError(c, 'npm test', 'Cannot find module lodash')
    recordError(c, 'npm test', 'Cannot find module lodash')

    const archived = runLocalDecayPass(c)
    expect(archived).toBe(0)
    expect(readErrorIndex(c).length).toBe(1)
  })
})

// ─── cleanupErrorIndex (legacy compat) ──────────────────────

describe('cleanupErrorIndex', () => {
  it('removes entries older than 90 days', () => {
    const c = cwd('cleanup')
    recordError(c, 'dotnet build', 'old error is long enough to pass filter')

    const errors = readErrorIndex(c)
    const oldDate = new Date()
    oldDate.setDate(oldDate.getDate() - 91)
    errors[0].lastSeen = oldDate.toISOString().slice(0, 10)

    const encoded = c.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 100)
    const errorsPath = resolve(tempDir, '.clauditor', 'knowledge', encoded, 'errors.json')
    mkdirSync(resolve(tempDir, '.clauditor', 'knowledge', encoded), { recursive: true })
    writeFileSync(errorsPath, JSON.stringify(errors))

    cleanupErrorIndex(c)
    expect(readErrorIndex(c).length).toBe(0)
  })
})
