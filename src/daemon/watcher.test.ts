import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionWatcher } from './watcher.js'
import { SessionStore } from './store.js'

function assistantLine(i: number): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: `a${i}`,
    parentUuid: null,
    sessionId: 's1',
    timestamp: `2025-01-01T00:00:0${i}Z`,
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text: 'x'.repeat(1000) }],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 1000,
      },
    },
  }) + '\n'
}

describe('SessionWatcher', () => {
  let projectsDir: string
  let filePath: string

  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), 'clauditor-watcher-'))
    mkdirSync(join(projectsDir, 'proj'))
    filePath = join(projectsDir, 'proj', 'session-1.jsonl')
    writeFileSync(filePath, assistantLine(1) + assistantLine(2))
  })

  afterEach(() => {
    rmSync(projectsDir, { recursive: true, force: true })
  })

  it('scanAll fills the store without keeping raw records in memory', async () => {
    const store = new SessionStore()
    const watcher = new SessionWatcher(store, { projectsDir })

    await watcher.scanAll()

    expect(store.getAll()).toHaveLength(1)
    expect(store.getAll()[0].turns).toHaveLength(2)
    // Raw records are only needed for incremental reads while watching.
    // Holding them for a one-shot scan exhausts the heap on large histories (#148).
    expect((watcher as any).fileRecords.size).toBe(0)
  })

  it('keeps records while watching so appended lines are read incrementally', async () => {
    const store = new SessionStore()
    const watcher = new SessionWatcher(store, { projectsDir })

    await watcher.start()
    try {
      expect((watcher as any).fileRecords.size).toBe(1)

      appendFileSync(filePath, assistantLine(3))
      await (watcher as any).processFileIncremental(filePath)

      expect(store.getAll()[0].turns).toHaveLength(3)
    } finally {
      await watcher.stop()
    }
  })
})
