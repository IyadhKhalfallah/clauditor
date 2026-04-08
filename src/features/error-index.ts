import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { scrubSecrets } from './secret-scrubber.js'

function clauditorDir(): string {
  return resolve(homedir(), '.clauditor')
}

// ─── Confidence & Decay ─────────────────────────────────────

const ERROR_HALF_LIFE_DAYS = 45
const MIN_CONFIDENCE = 0.05
const DECAY_ARCHIVE_THRESHOLD = 0.1

/** Noise patterns — transient errors that shouldn't be recorded. */
const NOISE_PATTERNS = [
  /command not found/i,
  /Unknown command/i,
  /not recognized as/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED.*localhost/i,
]

/**
 * Calculate effective confidence after temporal decay.
 * Half-life: 45 days for errors (version-dependent, go stale fast).
 */
export function effectiveConfidence(baseConfidence: number, lastSeenAt: string): number {
  const lastDate = new Date(lastSeenAt)
  if (isNaN(lastDate.getTime())) return baseConfidence
  const daysSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
  const decayFactor = Math.pow(0.5, daysSince / ERROR_HALF_LIFE_DAYS)
  return Math.max(MIN_CONFIDENCE, baseConfidence * decayFactor)
}

/**
 * Compute confidence tier label for display.
 */
export function confidenceTier(effective: number): 'confirmed' | 'observed' | 'inferred' | 'stale' {
  if (effective >= 0.7) return 'confirmed'
  if (effective >= 0.4) return 'observed'
  if (effective >= 0.2) return 'inferred'
  return 'stale'
}

/**
 * Check if an error message is transient noise.
 */
export function isNoiseError(errorMessage: string): boolean {
  if (errorMessage.length < 10) return true
  return NOISE_PATTERNS.some((p) => p.test(errorMessage))
}

// ─── Data Types ─────────────────────────────────────────────

export interface ErrorEntry {
  command: string
  error: string
  fix: string | null
  occurrences: number
  firstSeen: string
  lastSeen: string
  /** Timestamp of the most recent occurrence (ms since epoch) */
  lastErrorMs?: number
  /** Base confidence (0-1). Increases with occurrences and successful fixes. */
  confidence: number
}

// ─── Storage ────────────────────────────────────────────────

function getKnowledgeDir(cwd: string): string {
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 100)
  return resolve(clauditorDir(), 'knowledge', encoded)
}

function getErrorsPath(cwd: string): string {
  return resolve(getKnowledgeDir(cwd), 'errors.json')
}

export function readErrorIndex(cwd: string): ErrorEntry[] {
  try {
    const raw = JSON.parse(readFileSync(getErrorsPath(cwd), 'utf-8'))
    // Backfill confidence for legacy entries
    return raw.map((e: ErrorEntry) => ({
      ...e,
      confidence: e.confidence ?? confidenceFromOccurrences(e.occurrences, !!e.fix),
    }))
  } catch {
    return []
  }
}

/**
 * Derive initial confidence from occurrence count (for legacy entries without confidence field).
 */
function confidenceFromOccurrences(occurrences: number, hasFix: boolean): number {
  let c = 0.3
  if (occurrences >= 2) c = 0.5
  if (occurrences >= 5) c = 0.7
  if (hasFix) c = Math.min(1.0, c + 0.1)
  return c
}

// ─── Recording ──────────────────────────────────────────────

/**
 * Record a failed command. Called from PostToolUse when Bash fails.
 * Skips noise errors (typos, transient network issues).
 */
export function recordError(cwd: string, command: string, error: string): void {
  const truncatedError = error.slice(0, 200)

  // Noise filtering — don't record transient/typo errors
  if (isNoiseError(truncatedError)) return

  // Scrub secrets from command and error before storing locally
  const scrubbedCommand = scrubSecrets(command.slice(0, 200)).scrubbed
  const scrubbedError = scrubSecrets(truncatedError).scrubbed

  const errors = readErrorIndex(cwd)
  const baseCmd = extractBaseCommand(command)

  const existing = errors.find(e =>
    extractBaseCommand(e.command) === baseCmd &&
    similarError(e.error, scrubbedError)
  )

  if (existing) {
    existing.occurrences++
    existing.lastSeen = today()
    existing.lastErrorMs = Date.now()
    existing.error = scrubbedError
    // Confidence boost: recurring errors are more trustworthy
    existing.confidence = Math.min(1.0, existing.confidence + 0.05)
  } else {
    errors.push({
      command: scrubbedCommand,
      error: scrubbedError,
      fix: null,
      occurrences: 1,
      firstSeen: today(),
      lastSeen: today(),
      lastErrorMs: Date.now(),
      confidence: 0.3, // inferred — single occurrence
    })
  }

  writeErrors(cwd, errors)
}

/**
 * Record a fix for a recent error. Boosts confidence.
 *
 * The fix is the intermediate commands between the failure and success,
 * not the succeeding command itself. Example:
 *   `npm run build` fails → `npx drizzle-kit push` → `npm run build` succeeds
 *   Fix recorded: `npx drizzle-kit push`
 */
const FIX_PROXIMITY_MS = 120_000

const TRIVIAL_COMMANDS = new Set(['git', 'ls', 'cat', 'echo', 'cd', 'pwd', 'head', 'tail', 'grep', 'find', 'which', 'type', 'env', 'printenv', 'whoami', 'date', 'wc'])

// Command buffer is persisted to disk because each hook invocation is a separate process.
function commandBufferPath(cwd: string): string {
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 100)
  return resolve(clauditorDir(), 'knowledge', encoded, 'cmd-buffer.json')
}

function readCommandBuffer(cwd: string): string[] {
  try { return JSON.parse(readFileSync(commandBufferPath(cwd), 'utf-8')) } catch { return [] }
}

function writeCommandBuffer(cwd: string, buffer: string[]): void {
  const dir = getKnowledgeDir(cwd)
  mkdirSync(dir, { recursive: true })
  writeFileSync(commandBufferPath(cwd), JSON.stringify(buffer))
}

/** Track a command that ran (call on every Bash before checking if it's a fix). */
export function trackCommand(cwd: string, command: string): void {
  const buffer = readCommandBuffer(cwd)
  if (buffer.length >= 10) buffer.shift()
  buffer.push(scrubSecrets(command.slice(0, 200)).scrubbed)
  writeCommandBuffer(cwd, buffer)
}

/** Clear the command buffer when an error occurs. */
export function clearCommandBuffer(cwd: string): void {
  writeCommandBuffer(cwd, [])
}

export function recordFix(cwd: string, command: string): void {
  const errors = readErrorIndex(cwd)
  const baseCmd = extractBaseCommand(command)
  const now = Date.now()

  const unfixed = errors
    .filter(e =>
      extractBaseCommand(e.command) === baseCmd &&
      !e.fix &&
      e.lastErrorMs &&
      (now - e.lastErrorMs) < FIX_PROXIMITY_MS
    )
    .sort((a, b) => (b.lastErrorMs || 0) - (a.lastErrorMs || 0))[0]

  if (!unfixed) return

  // Use intermediate commands as the fix (what ran between failure and success)
  const buffer = readCommandBuffer(cwd)
  const intermediateSteps = buffer.filter(cmd => {
    const base = extractBaseCommand(cmd)
    if (base === baseCmd) return false
    if (TRIVIAL_COMMANDS.has(base)) return false
    return true
  })

  if (intermediateSteps.length > 0) {
    unfixed.fix = intermediateSteps.join(' && ')
  } else {
    unfixed.fix = scrubSecrets(command.slice(0, 200)).scrubbed
  }

  unfixed.confidence = Math.min(1.0, unfixed.confidence + 0.15)
  writeErrors(cwd, errors)
  writeCommandBuffer(cwd, [])
}

/**
 * Record an outcome for a known error.
 * Called by PostToolUse when a PreToolUse warning was active.
 */
export function recordOutcome(
  cwd: string,
  command: string,
  outcome: 'positive' | 'negative'
): void {
  const errors = readErrorIndex(cwd)
  const baseCmd = extractBaseCommand(command)

  const entry = errors.find(e =>
    extractBaseCommand(e.command) === baseCmd && e.fix
  )
  if (!entry) return

  if (outcome === 'positive') {
    entry.confidence = Math.min(1.0, entry.confidence + 0.1)
    entry.lastSeen = today()
  } else {
    entry.confidence = Math.max(MIN_CONFIDENCE, entry.confidence - 0.15)
  }

  writeErrors(cwd, errors)
}

// ─── Querying ───────────────────────────────────────────────

/**
 * Look up known errors for a command. Uses effective confidence (after decay).
 * Returns the most relevant error entry if one exists.
 */
export function findKnownError(cwd: string, command: string): ErrorEntry | null {
  const errors = readErrorIndex(cwd)
  const baseCmd = extractBaseCommand(command)

  const candidates = errors
    .filter(e => extractBaseCommand(e.command) === baseCmd)
    .map(e => ({
      ...e,
      effective: effectiveConfidence(e.confidence, e.lastSeen),
    }))
    .filter(e => e.effective >= 0.2) // skip stale entries
    .sort((a, b) => b.effective - a.effective)

  // Prefer entries with a fix
  const withFix = candidates.find(e => e.fix)
  if (withFix) return withFix

  // Fall back to high-confidence entries without fix
  const highConf = candidates.find(e => e.effective >= 0.4)
  return highConf || null
}

/**
 * Run decay pass — archive entries below threshold.
 * Returns count of archived entries.
 */
export function runLocalDecayPass(cwd: string): number {
  const errors = readErrorIndex(cwd)
  let archived = 0

  const surviving = errors.filter(e => {
    const eff = effectiveConfidence(e.confidence, e.lastSeen)
    if (eff < DECAY_ARCHIVE_THRESHOLD) {
      archived++
      return false
    }
    return true
  })

  if (archived > 0) {
    writeErrors(cwd, surviving)
  }
  return archived
}

/**
 * Clean up errors older than 90 days (legacy compat, superseded by decay).
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

// ─── Utilities ──────────────────────────────────────────────

/**
 * Extract the base command (binary name) from a full command string.
 */
export function extractBaseCommand(command: string): string {
  const trimmed = command.trim()
  const parts = trimmed.split(/\s+/)
  for (const part of parts) {
    if (part.includes('=') && !part.startsWith('-')) continue
    if (part === 'sudo' || part === 'npx' || part === 'bunx') continue
    return part
  }
  return parts[0] || trimmed
}

function similarError(a: string, b: string): boolean {
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
