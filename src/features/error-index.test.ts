import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { recordError, recordFix, findKnownError, readErrorIndex, extractBaseCommand, cleanupErrorIndex } from './error-index.js'

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

// Use tempDir in cwd to guarantee uniqueness per test
function cwd(label: string): string {
  return `${tempDir}/project-${label}`
}

describe('extractBaseCommand', () => {
  it('extracts binary name', () => {
    expect(extractBaseCommand('dotnet build')).toBe('dotnet')
    expect(extractBaseCommand('npm test')).toBe('npm')
    expect(extractBaseCommand('NODE_ENV=test npm test')).toBe('npm')
    expect(extractBaseCommand('sudo dotnet build')).toBe('dotnet')
    expect(extractBaseCommand('npx vitest run')).toBe('vitest')
  })
})

describe('recordError', () => {
  it('records a new error', () => {
    const c = cwd('new')
    recordError(c, 'dotnet build', 'error NETSDK1004')
    const errors = readErrorIndex(c)
    expect(errors.length).toBe(1)
    expect(errors[0].occurrences).toBe(1)
    expect(errors[0].fix).toBeNull()
  })

  it('increments occurrences for same base command + similar error', () => {
    const c = cwd('incr')
    recordError(c, 'dotnet build', 'error NETSDK1004: Assets file not found')
    recordError(c, 'dotnet build', 'error NETSDK1004: Assets file not found')
    recordError(c, 'dotnet build --no-restore', 'error NETSDK1004: Assets file not found')
    const errors = readErrorIndex(c)
    expect(errors.length).toBe(1)
    expect(errors[0].occurrences).toBe(3)
  })

  it('records different errors separately', () => {
    const c = cwd('diff')
    recordError(c, 'dotnet build', 'error NETSDK1004')
    recordError(c, 'npm test', 'Cannot find module')
    expect(readErrorIndex(c).length).toBe(2)
  })
})

describe('recordFix', () => {
  it('records a fix for a recent error', () => {
    const c = cwd('fix')
    recordError(c, 'dotnet build', 'error NETSDK1004')
    recordFix(c, 'dotnet build --no-restore')
    expect(readErrorIndex(c)[0].fix).toBe('dotnet build --no-restore')
  })

  it('does nothing when no matching error', () => {
    const c = cwd('nofix')
    recordFix(c, 'npm test')
    expect(readErrorIndex(c).length).toBe(0)
  })
})

describe('findKnownError', () => {
  it('finds errors with fix and 2+ occurrences', () => {
    const c = cwd('find1')
    recordError(c, 'dotnet build', 'error NETSDK1004')
    recordError(c, 'dotnet build', 'error NETSDK1004')
    recordFix(c, 'dotnet build --no-restore')
    const found = findKnownError(c, 'dotnet build')
    expect(found).not.toBeNull()
    expect(found!.fix).toBe('dotnet build --no-restore')
  })

  it('finds frequent errors without fix (3+)', () => {
    const c = cwd('find2')
    recordError(c, 'npm test', 'Cannot find module')
    recordError(c, 'npm test', 'Cannot find module')
    recordError(c, 'npm test', 'Cannot find module')
    const found = findKnownError(c, 'npm test')
    expect(found).not.toBeNull()
    expect(found!.occurrences).toBe(3)
  })

  it('returns null for unknown commands', () => {
    const c = cwd('unknown')
    expect(findKnownError(c, 'cargo build')).toBeNull()
  })

  it('returns null for 1 occurrence', () => {
    const c = cwd('one')
    recordError(c, 'dotnet build', 'error NETSDK1004')
    expect(findKnownError(c, 'dotnet build')).toBeNull()
  })
})

describe('cleanupErrorIndex', () => {
  it('removes entries older than 90 days', () => {
    const c = cwd('cleanup')
    recordError(c, 'dotnet build', 'old error')

    // Read, backdate, write back to the SAME file recordError created
    const errors = readErrorIndex(c)
    const oldDate = new Date()
    oldDate.setDate(oldDate.getDate() - 91)
    errors[0].lastSeen = oldDate.toISOString().slice(0, 10)

    // Re-record with the old date (recordError creates the dir)
    // Simplest: just call recordError again then overwrite
    const encoded = c.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 100)
    const errorsPath = resolve(tempDir, '.clauditor', 'knowledge', encoded, 'errors.json')
    mkdirSync(resolve(tempDir, '.clauditor', 'knowledge', encoded), { recursive: true })
    writeFileSync(errorsPath, JSON.stringify(errors))

    cleanupErrorIndex(c)
    expect(readErrorIndex(c).length).toBe(0)
  })
})
