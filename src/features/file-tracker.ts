import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, basename } from 'node:path'

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

// Track which sessions we've already counted per file (in-memory, per process).
// Note: each hook invocation is a separate process, so this Set is always fresh
// in production. In tests, call clearSessionCounted() between tests.
const sessionCounted = new Set<string>()

export function clearSessionCounted(): void {
  sessionCounted.clear()
}

/**
 * Record a file edit. Called from PostToolUse on Edit/Write.
 */
export function recordFileEdit(cwd: string, filePath: string, sessionId: string): void {
  const index = readFileIndex(cwd)
  const fileName = basename(filePath)

  if (!index[fileName]) {
    index[fileName] = {
      editCount: 0,
      readCount: 0,
      lastEdited: '',
      lastRead: '',
      sessions: 0,
    }
  }

  const entry = index[fileName]
  entry.editCount++
  entry.lastEdited = today()

  // Count session only once per file per process invocation
  const key = `${sessionId}:${fileName}`
  if (!sessionCounted.has(key)) {
    sessionCounted.add(key)
    entry.sessions++
  }

  writeFileIndex(cwd, index)
}

/**
 * Record a file read. Called from PostToolUse on Read.
 */
export function recordFileRead(cwd: string, filePath: string, sessionId: string): void {
  const index = readFileIndex(cwd)
  const fileName = basename(filePath)

  if (!index[fileName]) {
    index[fileName] = {
      editCount: 0,
      readCount: 0,
      lastEdited: '',
      lastRead: '',
      sessions: 0,
    }
  }

  const entry = index[fileName]
  entry.readCount++
  entry.lastRead = today()

  const key = `${sessionId}:${fileName}`
  if (!sessionCounted.has(key)) {
    sessionCounted.add(key)
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
  const fileName = basename(filePath)
  const entry = index[fileName]

  if (!entry) return null
  if (entry.editCount < 5 || entry.sessions < 3) return null

  return (
    `[clauditor]: ${fileName} — ${entry.editCount} edits across ${entry.sessions} sessions` +
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
