import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tempDir: string

async function importFresh(td: string) {
  vi.resetModules()
  vi.doMock('node:os', () => ({ homedir: () => td }))
  return await import('./query-cache.js')
}

describe('hub query cache', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clauditor-hub-cache-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('returns null when no entry exists', async () => {
    const mod = await importFresh(tempDir)
    expect(mod.getCached('proj-hash-1', 'command', 'npm test')).toBeNull()
  })

  it('round-trips a cached value', async () => {
    const mod = await importFresh(tempDir)
    const payload = { entries: [{ id: 'x', title: 'test entry', entry_type: 'error_fix' }] }
    mod.setCached('proj-hash-1', 'command', 'npm test', payload)
    expect(mod.getCached('proj-hash-1', 'command', 'npm test')).toEqual(payload)
  })

  it('keeps different queries separate within a project', async () => {
    const mod = await importFresh(tempDir)
    mod.setCached('proj-hash-1', 'command', 'npm test', { n: 1 })
    mod.setCached('proj-hash-1', 'file', 'src/foo.ts', { n: 2 })
    expect(mod.getCached('proj-hash-1', 'command', 'npm test')).toEqual({ n: 1 })
    expect(mod.getCached('proj-hash-1', 'file', 'src/foo.ts')).toEqual({ n: 2 })
  })

  it('keeps different projects separate', async () => {
    const mod = await importFresh(tempDir)
    mod.setCached('proj-a', 'command', 'npm test', { who: 'a' })
    mod.setCached('proj-b', 'command', 'npm test', { who: 'b' })
    expect(mod.getCached('proj-a', 'command', 'npm test')).toEqual({ who: 'a' })
    expect(mod.getCached('proj-b', 'command', 'npm test')).toEqual({ who: 'b' })
  })
})
