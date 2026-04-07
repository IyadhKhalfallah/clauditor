import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { readOutcomePending, clearOutcomePending } from './pre-tool-use.js'

let tempDir: string
let origHome: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clauditor-pretool-'))
  origHome = process.env.HOME || ''
  process.env.HOME = tempDir
})

afterEach(() => {
  process.env.HOME = origHome
  rmSync(tempDir, { recursive: true, force: true })
})

describe('readOutcomePending', () => {
  it('returns null when no file exists', () => {
    expect(readOutcomePending()).toBeNull()
  })

  it('returns null when file is empty object', () => {
    const { mkdirSync, writeFileSync } = require('node:fs')
    mkdirSync(resolve(tempDir, '.clauditor'), { recursive: true })
    writeFileSync(resolve(tempDir, '.clauditor', 'pretool-outcome-pending.json'), '{}')
    expect(readOutcomePending()).toBeNull()
  })

  it('returns null when pending is expired (>5 min)', () => {
    const { mkdirSync, writeFileSync } = require('node:fs')
    mkdirSync(resolve(tempDir, '.clauditor'), { recursive: true })
    writeFileSync(
      resolve(tempDir, '.clauditor', 'pretool-outcome-pending.json'),
      JSON.stringify({
        command: 'npm run build',
        baseCommand: 'npm run',
        timestamp: Date.now() - 6 * 60 * 1000, // 6 min ago
      })
    )
    expect(readOutcomePending()).toBeNull()
  })

  it('returns pending when within 5 min window', () => {
    const { mkdirSync, writeFileSync } = require('node:fs')
    mkdirSync(resolve(tempDir, '.clauditor'), { recursive: true })
    const pending = {
      command: 'npm run build',
      baseCommand: 'npm run',
      timestamp: Date.now() - 60 * 1000, // 1 min ago
      hubEntryIds: ['entry-1', 'entry-2'],
    }
    writeFileSync(
      resolve(tempDir, '.clauditor', 'pretool-outcome-pending.json'),
      JSON.stringify(pending)
    )
    const result = readOutcomePending()
    expect(result).not.toBeNull()
    expect(result!.command).toBe('npm run build')
    expect(result!.hubEntryIds).toEqual(['entry-1', 'entry-2'])
  })
})

describe('clearOutcomePending', () => {
  it('clears the pending state', () => {
    const { mkdirSync, writeFileSync } = require('node:fs')
    mkdirSync(resolve(tempDir, '.clauditor'), { recursive: true })
    writeFileSync(
      resolve(tempDir, '.clauditor', 'pretool-outcome-pending.json'),
      JSON.stringify({
        command: 'npm run build',
        baseCommand: 'npm run',
        timestamp: Date.now(),
      })
    )
    clearOutcomePending()
    expect(readOutcomePending()).toBeNull()
  })
})
