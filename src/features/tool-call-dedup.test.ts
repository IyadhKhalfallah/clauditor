import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

let tempDir: string

async function importFresh(td: string) {
  vi.resetModules()
  vi.doMock('node:os', () => ({ homedir: () => td }))
  return await import('./tool-call-dedup.js')
}

describe('fingerprintCall', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clauditor-dedup-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('returns null for unsupported tools', async () => {
    const mod = await importFresh(tempDir)
    expect(mod.fingerprintCall('Bash', { command: 'ls' })).toBeNull()
    expect(mod.fingerprintCall('Edit', { file_path: '/tmp/x' })).toBeNull()
  })

  it('fingerprints a Read call and includes the file path in the label', async () => {
    const mod = await importFresh(tempDir)
    const filePath = resolve(tempDir, 'src', 'foo.ts')
    const result = mod.fingerprintCall('Read', { file_path: filePath })
    expect(result).not.toBeNull()
    expect(result!.label).toContain('Read')
    expect(result!.label).toContain('foo.ts')
    expect(result!.fingerprint).toMatch(/^[a-f0-9]{16}$/)
  })

  it('produces different fingerprints when Read offset/limit differ', async () => {
    const mod = await importFresh(tempDir)
    const a = mod.fingerprintCall('Read', { file_path: '/tmp/x.ts', offset: 0, limit: 100 })
    const b = mod.fingerprintCall('Read', { file_path: '/tmp/x.ts', offset: 100, limit: 100 })
    expect(a!.fingerprint).not.toBe(b!.fingerprint)
  })

  it('fingerprints a Grep call including pattern and path', async () => {
    const mod = await importFresh(tempDir)
    const a = mod.fingerprintCall('Grep', { pattern: 'foo', path: 'src' })
    const b = mod.fingerprintCall('Grep', { pattern: 'foo', path: 'tests' })
    expect(a!.fingerprint).not.toBe(b!.fingerprint)
  })

  it('fingerprints a Glob call by pattern', async () => {
    const mod = await importFresh(tempDir)
    const result = mod.fingerprintCall('Glob', { pattern: 'src/**/*.ts' })
    expect(result!.label).toContain('src/**/*.ts')
  })
})

describe('checkAndRecord', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clauditor-dedup-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('returns null on first sighting and a hint on the second', async () => {
    const mod = await importFresh(tempDir)
    const sessionId = 'abc-123'
    const fp = 'deadbeef12345678'
    const label = 'Read src/foo.ts'

    const first = mod.checkAndRecord(sessionId, 'Read', fp, label)
    expect(first).toBeNull()

    const second = mod.checkAndRecord(sessionId, 'Read', fp, label)
    expect(second).toContain('already ran an equivalent Read')
    expect(second).toContain(label)
  })

  it('treats different sessions independently', async () => {
    const mod = await importFresh(tempDir)
    const fp = 'feedbeeffeedbeef'

    mod.checkAndRecord('session-a', 'Grep', fp, 'Grep "foo"')
    const result = mod.checkAndRecord('session-b', 'Grep', fp, 'Grep "foo"')
    expect(result).toBeNull()
  })

  it('clearSession removes a session and its fingerprints', async () => {
    const mod = await importFresh(tempDir)
    const sessionId = 'to-be-cleared'
    const fp = 'abcdef0123456789'

    mod.checkAndRecord(sessionId, 'Read', fp, 'Read /tmp/x.ts')
    mod.clearSession(sessionId)
    const afterClear = mod.checkAndRecord(sessionId, 'Read', fp, 'Read /tmp/x.ts')
    expect(afterClear).toBeNull()
  })

  it('Read fingerprint changes when the file is modified', async () => {
    const mod = await importFresh(tempDir)
    const filePath = resolve(tempDir, 'changing.txt')
    writeFileSync(filePath, 'first')
    const fp1 = mod.fingerprintCall('Read', { file_path: filePath })!

    // Force a different mtime
    const laterTime = new Date(Date.now() + 2000)
    writeFileSync(filePath, 'second')
    utimesSync(filePath, laterTime, laterTime)

    const fp2 = mod.fingerprintCall('Read', { file_path: filePath })!
    expect(fp1.fingerprint).not.toBe(fp2.fingerprint)
  })
})
