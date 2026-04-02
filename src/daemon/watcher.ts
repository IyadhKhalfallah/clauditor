import { watch, type FSWatcher } from 'chokidar'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { readdir, stat } from 'node:fs/promises'
import { parseJsonlFile, extractTurns, extractModel, extractSessionContext } from './parser.js'
import { SessionStore } from './store.js'

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

    // Watch for new/changed files going forward.
    // ignoreInitial: true since we already scanned above.
    // No awaitWriteFinish — it causes chokidar to delay or skip
    // events for already-stable files.
    this.watcher = watch(`${watchDir}/**/*.jsonl`, {
      persistent: true,
      ignoreInitial: true,
      usePolling: false,
    })

    this.watcher.on('add', (filePath) => this.processFile(filePath))
    this.watcher.on('change', (filePath) => this.processFile(filePath))
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

  /**
   * Scan and process all existing JSONL files (for stats command).
   */
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

  private async processFile(filePath: string): Promise<void> {
    try {
      const sessionId = extractSessionId(filePath)
      const projectPath = extractProjectPath(filePath, this.projectsDir)

      const records = await parseJsonlFile(filePath)
      const turns = extractTurns(records)
      const model = extractModel(records)
      const context = extractSessionContext(records)

      if (turns.length > 0) {
        this.store.update(sessionId, filePath, projectPath, turns, model, context)
      }
    } catch {
      // Ignore corrupt or in-progress files
    }
  }
}

/**
 * Encode a project path the same way Claude Code does:
 * replace every non-alphanumeric character with '-'
 */
export function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function extractSessionId(filePath: string): string {
  const parts = filePath.split('/')
  const filename = parts[parts.length - 1]
  return filename.replace('.jsonl', '')
}

function extractProjectPath(filePath: string, projectsDir: string): string {
  const relative = filePath.replace(projectsDir + '/', '')
  const parts = relative.split('/')
  // First segment is the encoded project path
  return parts[0] || 'unknown'
}

function resolveHome(filepath: string): string {
  if (filepath.startsWith('~/')) {
    return resolve(homedir(), filepath.slice(2))
  }
  return filepath
}
