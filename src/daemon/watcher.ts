import { watch, type FSWatcher } from 'chokidar'
import { resolve, basename, sep } from 'node:path'
import { homedir } from 'node:os'
import { readdir, stat, open } from 'node:fs/promises'
import { parseJsonlLine, parseJsonlFile, extractTurns, extractModel, extractSessionContext } from './parser.js'
import { hasResumeBoundary } from '../features/resume-detector.js'
import { SessionStore } from './store.js'
import type { SessionRecord } from '../types.js'

export interface WatcherOptions {
  projectsDir?: string
  projectPath?: string
  pollInterval?: number
}

export class SessionWatcher {
  private watcher: FSWatcher | null = null
  private store: SessionStore
  private projectsDir: string
  private projectPath: string | null
  private pollInterval: number

  // Track file offsets for incremental reading
  private fileOffsets = new Map<string, number>()
  // Cache parsed records per file so we only parse new lines
  private fileRecords = new Map<string, SessionRecord[]>()

  constructor(store: SessionStore, options: WatcherOptions = {}) {
    this.store = store
    this.projectsDir = resolveHome(options.projectsDir || '~/.claude/projects')
    this.projectPath = options.projectPath || null
    this.pollInterval = options.pollInterval || 1000
  }

  async start(): Promise<void> {
    // Eagerly scan existing files first so the TUI has data immediately
    await this.scanAll()

    const watchDir = this.projectPath
      ? resolve(this.projectsDir, encodeProjectPath(this.projectPath))
      : this.projectsDir

    // Watch the directory directly — chokidar v4 has issues with
    // glob patterns like **/*.jsonl on some systems. Filter in handlers.
    this.watcher = watch(watchDir, {
      persistent: true,
      ignoreInitial: true,
      usePolling: true,
      interval: this.pollInterval,
      depth: 4,
    })

    this.watcher.on('add', (filePath) => {
      if (filePath.endsWith('.jsonl')) this.processFile(filePath)
    })
    this.watcher.on('change', (filePath) => {
      if (filePath.endsWith('.jsonl')) this.processFileIncremental(filePath)
    })
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }

  getStore(): SessionStore {
    return this.store
  }

  async scanAll(): Promise<void> {
    const dir = this.projectPath
      ? resolve(this.projectsDir, encodeProjectPath(this.projectPath))
      : this.projectsDir

    try {
      await this.scanDirectory(dir)
    } catch {
      // Directory may not exist yet
    }
  }

  private async scanDirectory(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = resolve(dir, entry.name)
        if (entry.isDirectory()) {
          await this.scanDirectory(fullPath)
        } else if (entry.name.endsWith('.jsonl')) {
          await this.processFile(fullPath)
        }
      }
    } catch {
      // Ignore errors from missing directories
    }
  }

  /**
   * Full parse — used for initial scan and new files.
   */
  private async processFile(filePath: string): Promise<void> {
    try {
      const records = await parseJsonlFile(filePath)

      // Cache records and track file size for incremental reads
      this.fileRecords.set(filePath, records)
      try {
        const fileStat = await stat(filePath)
        this.fileOffsets.set(filePath, fileStat.size)
      } catch {}

      this.updateStore(filePath, records)
    } catch {
      // Ignore corrupt or in-progress files
    }
  }

  /**
   * Incremental parse — only read new bytes appended since last read.
   * Falls back to full parse if incremental read fails.
   */
  private async processFileIncremental(filePath: string): Promise<void> {
    const lastOffset = this.fileOffsets.get(filePath)

    if (lastOffset === undefined) {
      // Never seen this file — do a full parse
      return this.processFile(filePath)
    }

    try {
      const fileStat = await stat(filePath)

      if (fileStat.size <= lastOffset) {
        // File was truncated or unchanged — full re-parse
        return this.processFile(filePath)
      }

      // Read only the new bytes
      const fh = await open(filePath, 'r')
      try {
        const newBytes = Buffer.alloc(fileStat.size - lastOffset)
        await fh.read(newBytes, 0, newBytes.length, lastOffset)

        const newContent = newBytes.toString('utf-8')
        const newLines = newContent.split('\n')
        const newRecords: SessionRecord[] = []

        for (const line of newLines) {
          const record = parseJsonlLine(line)
          if (record) newRecords.push(record)
        }

        // Append new records to cache
        const existingRecords = this.fileRecords.get(filePath) || []
        const allRecords = [...existingRecords, ...newRecords]
        this.fileRecords.set(filePath, allRecords)
        this.fileOffsets.set(filePath, fileStat.size)

        this.updateStore(filePath, allRecords)
      } finally {
        await fh.close()
      }
    } catch {
      // Incremental failed — fall back to full parse
      return this.processFile(filePath)
    }
  }

  private updateStore(filePath: string, records: SessionRecord[]): void {
    const sessionId = extractSessionId(filePath)
    const projectPath = extractProjectPath(filePath, this.projectsDir)
    const turns = extractTurns(records)
    const model = extractModel(records)
    const context = extractSessionContext(records)
    const isResumed = hasResumeBoundary(records)

    if (turns.length > 0) {
      this.store.update(sessionId, filePath, projectPath, turns, model, context, isResumed)
    }
  }
}

export function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function extractSessionId(filePath: string): string {
  const filename = basename(filePath)
  return filename.replace('.jsonl', '')
}

function extractProjectPath(filePath: string, projectsDir: string): string {
  const relative = filePath
    .replace(projectsDir + sep, '')
    .replace(projectsDir + '/', '')
  const parts = relative.split(sep)
  return parts[0] || 'unknown'
}

function resolveHome(filepath: string): string {
  if (filepath.startsWith('~/')) {
    return resolve(homedir(), filepath.slice(2))
  }
  return filepath
}
