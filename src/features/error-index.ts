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
    existing.error = truncatedError // update to most recent error text
  } else {
    errors.push({
      command: command.slice(0, 200),
      error: truncatedError,
      fix: null,
      occurrences: 1,
      firstSeen: today(),
      lastSeen: today(),
    })
  }

  writeErrors(cwd, errors)
}

/**
 * Record a fix for a recent error. Called from PostToolUse when a command
 * succeeds after a recent failure with the same binary.
 *
 * Heuristic: same binary name within 3 turns, second one succeeds.
 */
export function recordFix(cwd: string, command: string): void {
  const errors = readErrorIndex(cwd)
  const baseCmd = extractBaseCommand(command)

  // Find the most recent unfixed error with the same base command
  const unfixed = errors
    .filter(e => extractBaseCommand(e.command) === baseCmd && !e.fix)
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))[0]

  if (!unfixed) return

  unfixed.fix = command.slice(0, 200)
  writeErrors(cwd, unfixed ? errors : errors)
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
  // Simple: check if they share the same first 50 chars (same error type)
  const prefixA = a.slice(0, 50).toLowerCase()
  const prefixB = b.slice(0, 50).toLowerCase()
  return prefixA === prefixB
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function writeErrors(cwd: string, errors: ErrorEntry[]): void {
  const dir = getKnowledgeDir(cwd)
  mkdirSync(dir, { recursive: true })
  writeFileSync(getErrorsPath(cwd), JSON.stringify(errors, null, 2))
}
