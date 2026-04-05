import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

const CACHE_DIR = resolve(homedir(), '.clauditor', 'hub-cache')

interface CachedBrain {
  content: unknown
  version: number
  token_count: number
  fragment_count: number
  etag: string
  cached_at: string
}

function cacheFile(projectHash: string): string {
  return resolve(CACHE_DIR, `${projectHash}.json`)
}

export function getCachedBrain(projectHash: string): CachedBrain | null {
  try {
    const data = JSON.parse(readFileSync(cacheFile(projectHash), 'utf-8'))

    // Check TTL (5 minutes)
    const age = Date.now() - new Date(data.cached_at).getTime()
    if (age > 5 * 60 * 1000) {
      return { ...data, _stale: true } as CachedBrain // Still return for offline fallback
    }

    return data
  } catch {
    return null
  }
}

export function getCachedEtag(projectHash: string): string | undefined {
  try {
    const data = JSON.parse(readFileSync(cacheFile(projectHash), 'utf-8'))
    return data.etag
  } catch {
    return undefined
  }
}

export function cacheBrain(projectHash: string, brain: { content: unknown; version: number; token_count: number; fragment_count: number; etag: string }): void {
  mkdirSync(CACHE_DIR, { recursive: true })
  const data: CachedBrain = {
    ...brain,
    cached_at: new Date().toISOString(),
  }
  writeFileSync(cacheFile(projectHash), JSON.stringify(data, null, 2))
}
