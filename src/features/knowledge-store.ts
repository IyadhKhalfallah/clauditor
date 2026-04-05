import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

const KNOWLEDGE_DIR = resolve(homedir(), '.clauditor', 'knowledge')
const ERRORS_FILE = resolve(KNOWLEDGE_DIR, 'errors.json')
const FILES_FILE = resolve(KNOWLEDGE_DIR, 'files.json')
const SUMMARIES_DIR = resolve(KNOWLEDGE_DIR, 'summaries')

export interface ErrorEntry {
  command: string
  error_message: string
  fix_command?: string
  reporters: number
  first_seen: string
  last_seen: string
}

export interface FileEntry {
  edit_count: number
  last_editor_hash: string
  last_modified: string
}

function ensureDirs(): void {
  mkdirSync(KNOWLEDGE_DIR, { recursive: true })
  mkdirSync(SUMMARIES_DIR, { recursive: true })
}

// ─── Errors ──────────────────────────────────────────────────────

export function readErrors(): ErrorEntry[] {
  try {
    return JSON.parse(readFileSync(ERRORS_FILE, 'utf-8'))
  } catch {
    return []
  }
}

export function addError(command: string, errorMessage: string, fixCommand?: string): void {
  ensureDirs()
  const errors = readErrors()
  const now = new Date().toISOString()

  // Deduplicate by command + error (first 100 chars)
  const key = `${command}::${errorMessage.slice(0, 100)}`
  const existing = errors.find(e => `${e.command}::${e.error_message.slice(0, 100)}` === key)

  if (existing) {
    existing.reporters += 1
    existing.last_seen = now
    if (fixCommand && !existing.fix_command) existing.fix_command = fixCommand
  } else {
    errors.push({
      command,
      error_message: errorMessage.slice(0, 500),
      fix_command: fixCommand,
      reporters: 1,
      first_seen: now,
      last_seen: now,
    })
  }

  // Keep max 500 errors, prune oldest
  const pruned = errors
    .sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime())
    .slice(0, 500)

  writeFileSync(ERRORS_FILE, JSON.stringify(pruned, null, 2))
}

export function findError(command: string): ErrorEntry | null {
  const errors = readErrors()
  // Match by base command (first word or two)
  const baseCmd = command.split(/\s+/).slice(0, 2).join(' ')
  return errors.find(e => e.command.startsWith(baseCmd) && e.fix_command) || null
}

// ─── Files ──────────────────────────────────────────────────────

export function readFileActivity(): Record<string, FileEntry> {
  try {
    return JSON.parse(readFileSync(FILES_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

export function recordFileActivity(filePath: string, developerHash: string): void {
  ensureDirs()
  const files = readFileActivity()
  const now = new Date().toISOString()

  if (files[filePath]) {
    files[filePath].edit_count += 1
    files[filePath].last_editor_hash = developerHash
    files[filePath].last_modified = now
  } else {
    files[filePath] = {
      edit_count: 1,
      last_editor_hash: developerHash,
      last_modified: now,
    }
  }

  // Prune files older than 30 days
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  for (const [path, entry] of Object.entries(files)) {
    if (new Date(entry.last_modified).getTime() < thirtyDaysAgo) {
      delete files[path]
    }
  }

  writeFileSync(FILES_FILE, JSON.stringify(files, null, 2))
}

// ─── Summaries ──────────────────────────────────────────────────

export function saveSummary(projectHash: string, content: string): string {
  ensureDirs()
  const filename = `${projectHash}-${Date.now()}.md`
  const filepath = resolve(SUMMARIES_DIR, filename)
  writeFileSync(filepath, content)

  // Prune old summaries (keep last 50)
  const files = readdirSync(SUMMARIES_DIR)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse()

  for (const f of files.slice(50)) {
    try { unlinkSync(resolve(SUMMARIES_DIR, f)) } catch {}
  }

  return filepath
}

export function getRecentSummaries(projectHash: string, limit = 5): string[] {
  try {
    return readdirSync(SUMMARIES_DIR)
      .filter(f => f.startsWith(projectHash) && f.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, limit)
      .map(f => readFileSync(resolve(SUMMARIES_DIR, f), 'utf-8'))
  } catch {
    return []
  }
}

// ─── Build fragments for hub push ────────────────────────────────

export function buildPushFragments(): Array<{type: string; content: Record<string, unknown>}> {
  const fragments: Array<{type: string; content: Record<string, unknown>}> = []

  // Errors with fixes
  const errors = readErrors().filter(e => e.fix_command)
  for (const e of errors.slice(0, 50)) {
    fragments.push({
      type: 'error',
      content: {
        command: e.command,
        error_message: e.error_message,
        fix_command: e.fix_command,
        reporters: e.reporters,
      },
    })
  }

  // File activity (top 100 most edited)
  const files = readFileActivity()
  const topFiles = Object.entries(files)
    .sort(([, a], [, b]) => b.edit_count - a.edit_count)
    .slice(0, 100)

  if (topFiles.length > 0) {
    fragments.push({
      type: 'file_activity',
      content: {
        files: Object.fromEntries(topFiles),
      },
    })
  }

  return fragments
}
