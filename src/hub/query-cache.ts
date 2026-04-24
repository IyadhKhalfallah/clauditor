import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

/**
 * Local TTL cache for hub queries.
 *
 * Every hub call is fire-and-forget over the network, but the returned
 * entries are then injected into Claude's context. Repeated queries for
 * the same (project_hash, query_type, query_value) during a work day
 * almost always return identical results, and each call costs:
 * - HTTP round-trip latency
 * - Response injection tokens in Claude's context
 *
 * A 10-minute TTL catches the most common case: running the same `npm test`
 * twice across two different sessions in the same project, or opening the
 * same file repeatedly. The cache is keyed on the query content only, so
 * different developers / projects don't collide.
 *
 * Entries are stored per-project on disk. No memory daemon. Hooks are
 * separate processes so disk is the shared state.
 */

const CACHE_TTL_MS = 10 * 60 * 1000

interface CacheEntry<T> {
  value: T
  writtenAt: number
}

function cachePath(projectHash: string): string {
  return resolve(homedir(), '.clauditor', 'hub-query-cache', `${projectHash}.json`)
}

function keyFor(queryType: string, queryValue: string): string {
  return createHash('sha256').update(`${queryType}|${queryValue}`).digest('hex').slice(0, 24)
}

export function getCached<T>(
  projectHash: string,
  queryType: string,
  queryValue: string,
): T | null {
  try {
    const store = JSON.parse(
      readFileSync(cachePath(projectHash), 'utf-8')
    ) as Record<string, CacheEntry<T>>
    const entry = store[keyFor(queryType, queryValue)]
    if (!entry) return null
    if (Date.now() - entry.writtenAt > CACHE_TTL_MS) return null
    return entry.value
  } catch {
    return null
  }
}

export function setCached<T>(
  projectHash: string,
  queryType: string,
  queryValue: string,
  value: T,
): void {
  let store: Record<string, CacheEntry<T>> = {}
  try {
    store = JSON.parse(readFileSync(cachePath(projectHash), 'utf-8'))
  } catch {}

  store[keyFor(queryType, queryValue)] = {
    value,
    writtenAt: Date.now(),
  }

  // Evict expired entries opportunistically so the file doesn't grow
  // forever. Only runs on write, not read.
  const now = Date.now()
  for (const k of Object.keys(store)) {
    if (now - store[k].writtenAt > CACHE_TTL_MS * 2) {
      delete store[k]
    }
  }

  try {
    mkdirSync(resolve(homedir(), '.clauditor', 'hub-query-cache'), { recursive: true })
    writeFileSync(cachePath(projectHash), JSON.stringify(store))
  } catch {}
}
