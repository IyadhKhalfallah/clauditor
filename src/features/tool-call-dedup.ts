import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

/**
 * Within-session tool-call deduplication.
 *
 * Reading the same file twice with no intervening Edit, or running the
 * same Grep pattern twice, is pure waste: the second call re-sends the
 * full tool_response to the model. Claude Code's prompt caching helps
 * across prefixes but doesn't suppress duplicate tool_results within a
 * session.
 *
 * How it works:
 * - PreToolUse fingerprints each Read/Grep/Glob call by hashing the input.
 * - Fingerprints are stored per-session on disk (hooks are separate
 *   processes, so disk is the only shared state).
 * - For Read, the fingerprint includes the file's current mtime. If the
 *   file was edited between calls, the fingerprint differs and the call
 *   is not treated as a duplicate.
 * - When a duplicate is detected, PreToolUse returns additionalContext
 *   reminding Claude that the same data was already fetched. Claude can
 *   still proceed with the call (hooks don't block this by default) but
 *   is encouraged to reference the earlier result instead.
 *
 * Note: we don't hard-block the tool call because the hook contract doesn't
 * cleanly support synthesizing a tool_result from a hook. Nudging Claude
 * to reference the earlier turn is the safest intervention that still
 * pays back in token savings on the model's next turn.
 */

const DEDUP_FILE = resolve(homedir(), '.clauditor', 'tool-call-dedup.json')
const MAX_ENTRIES_PER_SESSION = 200

interface DedupEntry {
  /** Turn or call index when this fingerprint was last seen */
  seenAt: number
  /** Tool name for friendlier messaging */
  tool: string
  /** Short human label for display */
  label: string
}

type DedupStore = Record<string, Record<string, DedupEntry>>

function readStore(): DedupStore {
  try {
    return JSON.parse(readFileSync(DEDUP_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function writeStore(store: DedupStore): void {
  try {
    mkdirSync(resolve(homedir(), '.clauditor'), { recursive: true })
    writeFileSync(DEDUP_FILE, JSON.stringify(store))
  } catch {}
}

/**
 * Build a fingerprint for a tool call. For Read, includes the file's
 * mtime so that an intervening edit invalidates the fingerprint.
 */
export function fingerprintCall(
  toolName: string,
  toolInput: Record<string, unknown>
): { fingerprint: string; label: string } | null {
  if (toolName === 'Read') {
    const fp = toolInput.file_path as string | undefined
    if (!fp) return null
    // Include mtime so edits invalidate the fingerprint. If the file
    // doesn't exist yet, mtime is 0 and the first call will establish it.
    let mtime = 0
    try { mtime = Math.floor(statSync(fp).mtimeMs) } catch {}
    const offset = toolInput.offset ?? ''
    const limit = toolInput.limit ?? ''
    const key = `Read|${fp}|${mtime}|${offset}|${limit}`
    return {
      fingerprint: hash(key),
      label: `Read ${shortName(fp)}`,
    }
  }

  if (toolName === 'Grep') {
    const pattern = toolInput.pattern as string | undefined
    if (!pattern) return null
    const path = toolInput.path ?? ''
    const glob = toolInput.glob ?? ''
    const outputMode = toolInput.output_mode ?? ''
    const key = `Grep|${pattern}|${path}|${glob}|${outputMode}`
    return {
      fingerprint: hash(key),
      label: `Grep "${pattern.slice(0, 40)}"`,
    }
  }

  if (toolName === 'Glob') {
    const pattern = toolInput.pattern as string | undefined
    if (!pattern) return null
    const path = toolInput.path ?? ''
    const key = `Glob|${pattern}|${path}`
    return {
      fingerprint: hash(key),
      label: `Glob ${pattern}`,
    }
  }

  return null
}

/**
 * Check whether this fingerprint was seen earlier in the session.
 * If so, returns a hint message. Otherwise records the fingerprint
 * and returns null.
 */
export function checkAndRecord(
  sessionId: string,
  toolName: string,
  fingerprint: string,
  label: string
): string | null {
  const store = readStore()
  if (!store[sessionId]) store[sessionId] = {}

  const entry = store[sessionId][fingerprint]
  if (entry) {
    // Duplicate. Don't bump seenAt; keep the first occurrence.
    return (
      `[clauditor]: You already ran an equivalent ${toolName} earlier (${entry.label}). ` +
      `If nothing relevant changed, reference the previous result instead of repeating the call.`
    )
  }

  // Cap per-session history so the file doesn't grow forever
  const keys = Object.keys(store[sessionId])
  if (keys.length >= MAX_ENTRIES_PER_SESSION) {
    // Drop the oldest half
    const sorted = keys
      .map((k) => ({ k, seenAt: store[sessionId][k].seenAt }))
      .sort((a, b) => a.seenAt - b.seenAt)
    for (const { k } of sorted.slice(0, Math.floor(keys.length / 2))) {
      delete store[sessionId][k]
    }
  }

  store[sessionId][fingerprint] = {
    seenAt: Date.now(),
    tool: toolName,
    label,
  }
  writeStore(store)
  return null
}

/**
 * Clear a session's dedup history. Called at session end or after rotation.
 */
export function clearSession(sessionId: string): void {
  const store = readStore()
  if (store[sessionId]) {
    delete store[sessionId]
    writeStore(store)
  }
}

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

function shortName(filePath: string): string {
  const parts = filePath.split('/')
  return parts.slice(-2).join('/')
}
