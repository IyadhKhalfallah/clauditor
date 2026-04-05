import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { recordFileEdit, recordFileRead, readFileIndex, getFileContext, cleanupFileIndex, clearSessionCounted } from './file-tracker.js'

let tempDir: string
let origHome: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clauditor-ft-'))
  origHome = process.env.HOME || ''
  process.env.HOME = tempDir
  clearSessionCounted()
})

afterEach(() => {
  process.env.HOME = origHome
  rmSync(tempDir, { recursive: true, force: true })
})

function cwd(label: string): string {
  return `${tempDir}/project-${label}`
}

describe('recordFileEdit', () => {
  it('records a file edit', () => {
    const c = cwd('edit1')
    recordFileEdit(c, `${c}/src/app.ts`, 'session-1')
    const index = readFileIndex(c)
    expect(index['app.ts'].editCount).toBe(1)
    expect(index['app.ts'].sessions).toBe(1)
  })

  it('increments edit count, sessions stays at 1 for same session', () => {
    const c = cwd('edit2')
    recordFileEdit(c, `${c}/src/app.ts`, 'session-1')
    recordFileEdit(c, `${c}/src/app.ts`, 'session-1')
    recordFileEdit(c, `${c}/src/app.ts`, 'session-1')
    const index = readFileIndex(c)
    expect(index['app.ts'].editCount).toBe(3)
    expect(index['app.ts'].sessions).toBe(1)
  })
})

describe('recordFileRead', () => {
  it('records a file read', () => {
    const c = cwd('read1')
    recordFileRead(c, `${c}/config.json`, 'session-1')
    const index = readFileIndex(c)
    expect(index['config.json'].readCount).toBe(1)
  })
})

describe('getFileContext', () => {
  it('returns null for files below threshold', () => {
    const c = cwd('below')
    recordFileEdit(c, `${c}/src/app.ts`, 'session-1')
    expect(getFileContext(c, `${c}/src/app.ts`)).toBeNull()
  })

  it('returns context for hot files (5+ edits, 3+ sessions)', () => {
    const c = cwd('hot')
    for (let s = 1; s <= 4; s++) {
      for (let e = 0; e < 2; e++) {
        recordFileEdit(c, `${c}/src/hot.ts`, `session-${s}`)
      }
    }
    const index = readFileIndex(c)
    expect(index['hot.ts'].editCount).toBe(8)
    expect(index['hot.ts'].sessions).toBe(4)

    const ctx = getFileContext(c, `${c}/src/hot.ts`)
    expect(ctx).not.toBeNull()
    expect(ctx).toContain('8 edits')
    expect(ctx).toContain('4 sessions')
  })

  it('returns null for unknown files', () => {
    const c = cwd('unknown')
    expect(getFileContext(c, `${c}/unknown.ts`)).toBeNull()
  })
})

describe('cleanupFileIndex', () => {
  it('removes files not touched in 90 days', () => {
    const c = cwd('cleanup')
    recordFileEdit(c, `${c}/src/old.ts`, 'session-1')

    const index = readFileIndex(c)
    const oldDate = new Date()
    oldDate.setDate(oldDate.getDate() - 91)
    index['old.ts'].lastEdited = oldDate.toISOString().slice(0, 10)

    const encoded = c.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 100)
    const dir = resolve(tempDir, '.clauditor', 'knowledge', encoded)
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, 'files.json'), JSON.stringify(index))

    cleanupFileIndex(c)
    expect(readFileIndex(c)['old.ts']).toBeUndefined()
  })
})
