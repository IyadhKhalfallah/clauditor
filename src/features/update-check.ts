import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'

const CLAUDITOR_DIR = resolve(homedir(), '.clauditor')
const VERSION_CACHE = resolve(CLAUDITOR_DIR, 'version-check.json')
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

interface VersionCache {
  checkedAt: number
  latest: string | null
}

/**
 * Check if a newer version is available on npm.
 * Cached for 24h to avoid slowing down every command.
 * Returns the latest version string, or null if current is up to date.
 */
/**
 * Simple semver comparison: is `a` newer than `b`?
 */
function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true
    if ((pa[i] || 0) < (pb[i] || 0)) return false
  }
  return false
}

/**
 * Detect how clauditor was installed so we can suggest the right upgrade command.
 */
export function getInstallMethod(): 'brew' | 'npm' {
  try {
    const brewPrefix = execSync('brew --prefix 2>/dev/null', {
      timeout: 3000,
      encoding: 'utf-8',
    }).trim()
    if (process.argv[1]?.startsWith(brewPrefix)) return 'brew'
  } catch {}
  return 'npm'
}

export function getUpgradeCommand(method: 'brew' | 'npm'): string {
  return method === 'brew'
    ? 'brew upgrade clauditor'
    : 'npm install -g @iyadhk/clauditor@latest'
}

export function checkForUpdate(currentVersion: string): string | null {
  // Read cache
  try {
    const cache: VersionCache = JSON.parse(readFileSync(VERSION_CACHE, 'utf-8'))
    if (Date.now() - cache.checkedAt < CHECK_INTERVAL_MS) {
      // Cache is fresh
      if (cache.latest && isNewer(cache.latest, currentVersion)) {
        return cache.latest
      }
      return null
    }
  } catch {}

  // Cache expired or missing — check npm (non-blocking, fast timeout)
  try {
    const result = execSync('npm view @iyadhk/clauditor version 2>/dev/null', {
      timeout: 3000,
      encoding: 'utf-8',
    }).trim()

    // Save to cache
    try {
      mkdirSync(CLAUDITOR_DIR, { recursive: true })
      writeFileSync(VERSION_CACHE, JSON.stringify({
        checkedAt: Date.now(),
        latest: result,
      }))
    } catch {}

    if (result && isNewer(result, currentVersion)) {
      return result
    }
  } catch {
    // Network error — skip silently
  }

  return null
}
