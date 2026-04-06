import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'

/**
 * Get the normalized git remote URL for the repo at the given path.
 * Normalizes SSH and HTTPS URLs to a canonical form:
 *   git@github.com:user/repo.git → github.com/user/repo
 *   https://github.com/user/repo.git → github.com/user/repo
 *
 * Returns null if not a git repo or no remote configured.
 */
export function getGitRemoteUrl(cwd?: string): string | null {
  try {
    const raw = execSync('git remote get-url origin', {
      cwd: cwd || process.cwd(),
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()

    return normalizeGitUrl(raw)
  } catch {
    return null
  }
}

/**
 * Normalize a git URL to a canonical form without protocol or .git suffix.
 *   git@github.com:user/repo.git → github.com/user/repo
 *   https://github.com/user/repo.git → github.com/user/repo
 *   ssh://git@github.com/user/repo → github.com/user/repo
 */
export function normalizeGitUrl(url: string): string {
  let normalized = url.trim()

  // SSH format: git@host:user/repo.git
  const sshMatch = normalized.match(/^[\w-]+@([^:]+):(.+)$/)
  if (sshMatch) {
    normalized = `${sshMatch[1]}/${sshMatch[2]}`
  } else {
    // HTTPS/SSH protocol: https://host/user/repo or ssh://git@host/user/repo
    normalized = normalized
      .replace(/^(https?|ssh|git):\/\//, '')
      .replace(/^[\w-]+@/, '') // strip user@ prefix
  }

  // Strip trailing .git
  normalized = normalized.replace(/\.git$/, '')

  // Strip trailing slashes
  normalized = normalized.replace(/\/+$/, '')

  return normalized
}

/**
 * Get a stable project hash from the git remote URL.
 * Returns null if not a git repo or no remote.
 */
export function getProjectHash(cwd?: string): string | null {
  const remoteUrl = getGitRemoteUrl(cwd)
  if (!remoteUrl) return null

  return createHash('sha256').update(remoteUrl).digest('hex').slice(0, 16)
}

/**
 * Get the project identifier (normalized remote URL) for display purposes.
 * Returns null if not a git repo.
 */
export function getProjectIdentifier(cwd?: string): string | null {
  return getGitRemoteUrl(cwd)
}
