import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

function clauditorDir(): string {
  return resolve(homedir(), '.clauditor')
}

export interface FileEntry {
  editCount: number
  readCount: number
  lastEdited: string
  lastRead: string
  sessions: number
}

export type FileIndex = Record<string, FileEntry>

function getKnowledgeDir(cwd: string): string {
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 100)
  return resolve(clauditorDir(), 'knowledge', encoded)
}

function getFilesPath(cwd: string): string {
  return resolve(getKnowledgeDir(cwd), 'files.json')
}

/**
 * Read the file index for a project.
 */
export function readFileIndex(cwd: string): FileIndex {
  try {
    return JSON.parse(readFileSync(getFilesPath(cwd), 'utf-8'))
  } catch {
    return {}
  }
}

// Track which sessions we've already counted per file.
// Persisted to disk because each hook invocation is a separate process.
function getSessionCountedPath(cwd: string): string {
  return resolve(getKnowledgeDir(cwd), 'session-counted.json')
}

function readSessionCounted(cwd: string): Record<string, boolean> {
  try {
    return JSON.parse(readFileSync(getSessionCountedPath(cwd), 'utf-8'))
  } catch {
    return {}
  }
}

function writeSessionCounted(cwd: string, data: Record<string, boolean>): void {
  const dir = getKnowledgeDir(cwd)
  mkdirSync(dir, { recursive: true })
  writeFileSync(getSessionCountedPath(cwd), JSON.stringify(data))
}

// For tests only
export function clearSessionCounted(): void {
  // No-op now — disk-based, cleared by temp dir cleanup in tests
}

/**
 * Get a file key that avoids basename collisions.
 * Uses last 2 path segments: "utils/index.ts" instead of just "index.ts".
 */
function fileKey(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts.slice(-2).join('/')
}

/**
 * Record a file edit. Called from PostToolUse on Edit/Write.
 */
export function recordFileEdit(cwd: string, filePath: string, sessionId: string): void {
  const index = readFileIndex(cwd)
  const key = fileKey(filePath)

  if (!index[key]) {
    index[key] = {
      editCount: 0,
      readCount: 0,
      lastEdited: '',
      lastRead: '',
      sessions: 0,
    }
  }

  const entry = index[key]
  entry.editCount++
  entry.lastEdited = today()

  // Count session only once per file — persisted to disk
  const counted = readSessionCounted(cwd)
  const countKey = `${sessionId}:${key}`
  if (!counted[countKey]) {
    counted[countKey] = true
    writeSessionCounted(cwd, counted)
    entry.sessions++
  }

  writeFileIndex(cwd, index)
}

/**
 * Record a file read. Called from PostToolUse on Read.
 */
export function recordFileRead(cwd: string, filePath: string, sessionId: string): void {
  const index = readFileIndex(cwd)
  const key = fileKey(filePath)

  if (!index[key]) {
    index[key] = {
      editCount: 0,
      readCount: 0,
      lastEdited: '',
      lastRead: '',
      sessions: 0,
    }
  }

  const entry = index[key]
  entry.readCount++
  entry.lastRead = today()

  const counted = readSessionCounted(cwd)
  const countKey = `${sessionId}:${key}`
  if (!counted[countKey]) {
    counted[countKey] = true
    writeSessionCounted(cwd, counted)
    entry.sessions++
  }

  writeFileIndex(cwd, index)
}

/**
 * Get context for a file if it's a "hot" file (5+ edits, 3+ sessions).
 * Returns a brief context string for PostToolUse injection.
 */
export function getFileContext(cwd: string, filePath: string): string | null {
  const index = readFileIndex(cwd)
  const key = fileKey(filePath)
  const entry = index[key]

  if (!entry) return null
  if (entry.editCount < 5 || entry.sessions < 3) return null

  const displayName = key.split('/').pop() || key
  return (
    `[clauditor]: ${displayName} — ${entry.editCount} edits across ${entry.sessions} sessions` +
    (entry.lastEdited ? `, last edited ${entry.lastEdited}` : '') +
    `. This is a frequently modified file — review changes carefully.`
  )
}

/**
 * Clean up files not touched in 90 days.
 */
export function cleanupFileIndex(cwd: string): void {
  const index = readFileIndex(cwd)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 90)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  let changed = false
  for (const [name, entry] of Object.entries(index)) {
    const lastTouch = entry.lastEdited || entry.lastRead || ''
    if (lastTouch && lastTouch < cutoffStr) {
      delete index[name]
      changed = true
    }
  }

  if (changed) writeFileIndex(cwd, index)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function writeFileIndex(cwd: string, index: FileIndex): void {
  const dir = getKnowledgeDir(cwd)
  mkdirSync(dir, { recursive: true })
  writeFileSync(getFilesPath(cwd), JSON.stringify(index, null, 2))
}
