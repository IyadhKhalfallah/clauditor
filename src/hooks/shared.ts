import { readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import type { HookDecision } from '../types.js'

/**
 * Read JSON from stdin — used by all hooks.
 */
export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk: string) => (data += chunk))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

/**
 * Write hook decision to stdout.
 */
export function outputDecision(decision: HookDecision): void {
  process.stdout.write(JSON.stringify(decision))
}

/**
 * Find transcript JSONL path for a session ID by scanning ~/.claude/projects/.
 * Synchronous — safe for hooks.
 */
export function findTranscriptPathSync(sessionId: string): string | null {
  const projectsDir = resolve(homedir(), '.claude/projects')
  try {
    const dirs = readdirSync(projectsDir, { withFileTypes: true })
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue
      const candidate = resolve(projectsDir, dir.name, `${sessionId}.jsonl`)
      try {
        readFileSync(candidate, { flag: 'r' })
        return candidate
      } catch {}
    }
  } catch {}
  return null
}

/**
 * Atomically write a JSON state file using tmp + rename.
 * Prevents corruption (partial writes) when multiple concurrent sessions
 * write to the same file. NOTE: does not prevent lost updates — concurrent
 * read-modify-write cycles can overwrite each other's changes. This is
 * acceptable for the state files used here (timestamps, counters, booleans).
 */
export function writeJsonFileAtomic(filePath: string, data: unknown): void {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true })
  const tmpPath = filePath + '.' + randomBytes(4).toString('hex') + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(data))
  renameSync(tmpPath, filePath)
}

/**
 * Read a JSON state file, returning fallback on missing/corrupt.
 */
export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T
  } catch {
    return fallback
  }
}

/**
 * Prune stale entries from all clauditor state files.
 * Keeps entries for sessions active in the last 7 days.
 * Called once per session start — lightweight cleanup.
 */
export function pruneStaleStateFiles(): void {
  const stateDir = resolve(homedir(), '.clauditor')
  const stateFiles = [
    'prompt-block-nudge.json',
    'rotation-nudge.json',
    'skill-nudge.json',
    'edit-counts.json',
    'health-check-ts.json',
  ]
  const MAX_ENTRIES = 200 // keep at most 200 session entries per file

  for (const file of stateFiles) {
    const filePath = resolve(stateDir, file)
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'))
      if (typeof data !== 'object' || data === null) continue
      const keys = Object.keys(data)
      if (keys.length <= MAX_ENTRIES) continue

      // Keep only the most recent MAX_ENTRIES entries.
      // For timestamp-valued files (health-check-ts), sort by value.
      // For others, keep the last MAX_ENTRIES keys (insertion order).
      const isTimestampFile = file === 'health-check-ts.json'
      let keysToKeep: string[]
      if (isTimestampFile) {
        keysToKeep = keys
          .sort((a, b) => (data[b] as number) - (data[a] as number))
          .slice(0, MAX_ENTRIES)
      } else {
        keysToKeep = keys.slice(-MAX_ENTRIES)
      }

      const pruned: Record<string, unknown> = {}
      for (const k of keysToKeep) pruned[k] = data[k]
      writeJsonFileAtomic(filePath, pruned)
    } catch {
      // File missing or corrupt — skip
    }
  }
}
