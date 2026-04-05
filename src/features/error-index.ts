import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, basename } from 'node:path'

function clauditorDir(): string {
  return resolve(homedir(), '.clauditor')
}

export interface ErrorEntry {
  command: string
  error: string
  fix: string | null
  occurrences: number
  firstSeen: string
  lastSeen: string
  /** Timestamp of the most recent occurrence (ms since epoch) */
  lastErrorMs?: number
}

/**
 * Get the knowledge directory for a project.
 */
function getKnowledgeDir(cwd: string): string {
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 100)
  return resolve(clauditorDir(), 'knowledge', encoded)
}

function getErrorsPath(cwd: string): string {
  return resolve(getKnowledgeDir(cwd), 'errors.json')
}

/**
 * Read the error index for a project.
 */
export function readErrorIndex(cwd: string): ErrorEntry[] {
  try {
    return JSON.parse(readFileSync(getErrorsPath(cwd), 'utf-8'))
  } catch {
    return []
  }
}

/**
 * Record a failed command. Called from PostToolUse when Bash fails.
 */
export function recordError(cwd: string, command: string, error: string): void {
  const errors = readErrorIndex(cwd)
  const baseCmd = extractBaseCommand(command)
  const truncatedError = error.slice(0, 200)

  // Find existing entry with same base command and similar error
  const existing = errors.find(e =>
    extractBaseCommand(e.command) === baseCmd &&
    similarError(e.error, truncatedError)
  )

  if (existing) {
    existing.occurrences++
    existing.lastSeen = today()
    existing.lastErrorMs = Date.now()
    existing.error = truncatedError
  } else {
    errors.push({
      command: command.slice(0, 200),
      error: truncatedError,
      fix: null,
      occurrences: 1,
      firstSeen: today(),
      lastSeen: today(),
      lastErrorMs: Date.now(),
    })
  }

  writeErrors(cwd, errors)
}

/**
 * Record a fix for a recent error. Called from PostToolUse when a command
 * succeeds after a recent failure with the same binary.
 *
 * Only records if the error occurred within the last 60 seconds (proximity check).
 */
const FIX_PROXIMITY_MS = 60_000

export function recordFix(cwd: string, command: string): void {
  const errors = readErrorIndex(cwd)
  const baseCmd = extractBaseCommand(command)
  const now = Date.now()

  // Find the most recent unfixed error with the same base command, within 60s
  const unfixed = errors
    .filter(e =>
      extractBaseCommand(e.command) === baseCmd &&
      !e.fix &&
      e.lastErrorMs &&
      (now - e.lastErrorMs) < FIX_PROXIMITY_MS
    )
    .sort((a, b) => (b.lastErrorMs || 0) - (a.lastErrorMs || 0))[0]

  if (!unfixed) return

  unfixed.fix = command.slice(0, 200)
  writeErrors(cwd, errors)
}

/**
 * Look up known errors for a command. Used by PreToolUse.
 * Returns the most relevant error entry if one exists.
 */
export function findKnownError(cwd: string, command: string): ErrorEntry | null {
  const errors = readErrorIndex(cwd)
  const baseCmd = extractBaseCommand(command)

  // Find errors with the same base command that have a known fix
  const withFix = errors.find(e =>
    extractBaseCommand(e.command) === baseCmd && e.fix && e.occurrences >= 2
  )
  if (withFix) return withFix

  // Also return errors without a fix but with 3+ occurrences (warn only)
  const frequent = errors.find(e =>
    extractBaseCommand(e.command) === baseCmd && e.occurrences >= 3
  )
  return frequent || null
}

/**
 * Clean up errors older than 90 days.
 */
export function cleanupErrorIndex(cwd: string): void {
  const errors = readErrorIndex(cwd)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 90)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const filtered = errors.filter(e => e.lastSeen >= cutoffStr)
  if (filtered.length < errors.length) {
    writeErrors(cwd, filtered)
  }
}

/**
 * Extract the base command (binary name) from a full command string.
 * "dotnet build --no-restore" → "dotnet"
 * "npm test -- --watch" → "npm"
 * "python3 -m pytest" → "python3"
 */
export function extractBaseCommand(command: string): string {
  const trimmed = command.trim()
  // Skip env vars and redirects at the start
  const parts = trimmed.split(/\s+/)
  for (const part of parts) {
    // Skip env var assignments (KEY=value)
    if (part.includes('=') && !part.startsWith('-')) continue
    // Skip common prefixes
    if (part === 'sudo' || part === 'npx' || part === 'bunx') continue
    return part
  }
  return parts[0] || trimmed
}

/**
 * Check if two error messages are similar enough to be the same error.
 */
function similarError(a: string, b: string): boolean {
  // Compare first lines — distinguishes "error TS2322: Type 'string'" from "error TS2322: Type 'Date'"
  const lineA = a.split('\n')[0].trim().toLowerCase()
  const lineB = b.split('\n')[0].trim().toLowerCase()
  return lineA === lineB
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function writeErrors(cwd: string, errors: ErrorEntry[]): void {
  const dir = getKnowledgeDir(cwd)
  mkdirSync(dir, { recursive: true })
  writeFileSync(getErrorsPath(cwd), JSON.stringify(errors, null, 2))
}
