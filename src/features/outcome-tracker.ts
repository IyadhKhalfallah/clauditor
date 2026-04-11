/**
 * Outcome Tracker — measures whether injected knowledge actually helped.
 *
 * Flow:
 *   1. Session start: recordInjection(sessionId, entryIds)
 *   2. Session end (stop hook): reportOutcomes(sessionId, cwd, healthy)
 *      - If session was healthy → positive outcome for all injected entries
 *      - If not → no penalty (warning might not have been relevant)
 *
 * The positive signal feeds back into the hub's ranking system:
 * entries with more positive outcomes rank higher in future briefs.
 *
 * Persisted to disk because each hook invocation is a separate process.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

const TRACKER_DIR = resolve(homedir(), '.clauditor')
const INJECTIONS_FILE = resolve(TRACKER_DIR, 'injections.json')

interface InjectionRecord {
  sessionId: string
  entryIds: string[]
  timestamp: number
}

/**
 * Record which knowledge entry IDs were injected at session start.
 */
export function recordInjection(sessionId: string, entryIds: string[]): void {
  try {
    mkdirSync(TRACKER_DIR, { recursive: true })
    const data = readInjections()

    // Keep only last 7 days to avoid bloat
    const recent = data.filter(d => Date.now() - d.timestamp < 7 * 24 * 60 * 60 * 1000)
    recent.push({ sessionId, entryIds, timestamp: Date.now() })

    writeFileSync(INJECTIONS_FILE, JSON.stringify(recent.slice(-20), null, 2))
  } catch {}
}

/**
 * Get the injected entry IDs for a session.
 */
export function getInjectedIds(sessionId: string): string[] {
  const data = readInjections()
  const record = data.find(d => d.sessionId === sessionId)
  return record?.entryIds || []
}

/**
 * Report outcomes for a session to the hub.
 *
 * If the session was healthy (no loops, no crashes), all injected
 * entries get a positive signal. This is the simplest heuristic:
 * "the knowledge was available and nothing went wrong."
 *
 * Over time, entries that are consistently present in healthy sessions
 * rise in ranking. Entries that are injected but sessions still fail
 * don't get penalized (maybe the failure was unrelated).
 */
export async function reportOutcomes(
  sessionId: string,
  cwd: string,
  sessionHealthy: boolean
): Promise<number> {
  const entryIds = getInjectedIds(sessionId)
  if (entryIds.length === 0) return 0

  // Only report positive outcomes for healthy sessions
  if (!sessionHealthy) return 0

  try {
    const { resolveHubContext } = await import('../hub/client.js')
    const hub = resolveHubContext(cwd)
    if (!hub) return 0

    const res = await fetch(`${hub.config.url}/api/v1/knowledge/outcome`, {
      method: 'POST',
      headers: {
        'X-Clauditor-Key': hub.config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        entry_ids: entryIds,
        outcome: 'positive',
      }),
    })

    if (res.ok) {
      const data = await res.json() as { updated: number }
      return data.updated
    }
  } catch {}

  return 0
}

function readInjections(): InjectionRecord[] {
  try {
    return JSON.parse(readFileSync(INJECTIONS_FILE, 'utf-8'))
  } catch {
    return []
  }
}
