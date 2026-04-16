import { appendFile, readFile, mkdir, writeFile, stat, rename } from 'node:fs/promises'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'

const ACTIVITY_DIR = resolve(homedir(), '.clauditor')
const ACTIVITY_FILE = resolve(ACTIVITY_DIR, 'activity.log')
const MAX_LOG_BYTES = 1_000_000 // rotate at ~1MB

export interface ActivityEvent {
  timestamp: string
  type: 'cache_warning' | 'loop_blocked' | 'resume_warning' | 'context_warning' | 'bash_compressed' | 'notification' | 'burn_rate_warning' | 'auto_rotation'
  session: string
  message: string
}

/**
 * Log an activity event. Called by hooks and the daemon when they take action.
 * Rotates the log file when it exceeds ~1MB to prevent unbounded growth.
 */
export async function logActivity(event: Omit<ActivityEvent, 'timestamp'>): Promise<void> {
  try {
    await mkdir(ACTIVITY_DIR, { recursive: true })
    const entry: ActivityEvent = {
      timestamp: new Date().toISOString(),
      ...event,
    }
    await appendFile(ACTIVITY_FILE, JSON.stringify(entry) + '\n')

    // Rotate if too large — keep last half of the file
    try {
      const info = await stat(ACTIVITY_FILE)
      if (info.size > MAX_LOG_BYTES) {
        const content = await readFile(ACTIVITY_FILE, 'utf-8')
        const lines = content.trim().split('\n')
        const keepLines = lines.slice(Math.floor(lines.length / 2))
        const tmpPath = ACTIVITY_FILE + '.' + randomBytes(4).toString('hex') + '.tmp'
        await writeFile(tmpPath, keepLines.join('\n') + '\n')
        await rename(tmpPath, ACTIVITY_FILE)
      }
    } catch {
      // Rotation failure is non-critical
    }
  } catch {
    // Non-critical — don't break the hook if logging fails
  }
}

/**
 * Read recent activity events.
 */
export async function readActivity(limit: number = 50): Promise<ActivityEvent[]> {
  try {
    const content = await readFile(ACTIVITY_FILE, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    const events: ActivityEvent[] = []

    // Read from the end for most recent first
    for (let i = lines.length - 1; i >= 0 && events.length < limit; i--) {
      try {
        events.push(JSON.parse(lines[i]))
      } catch {
        continue
      }
    }

    return events
  } catch {
    return []
  }
}

/**
 * Format a time-ago string from an ISO timestamp.
 */
function timeAgo(timestamp: string): string {
  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

const TYPE_ICONS: Record<ActivityEvent['type'], string> = {
  cache_warning: '⚡',
  loop_blocked: '🛑',
  resume_warning: '⚠',
  context_warning: '📦',
  bash_compressed: '📦',
  notification: '🔔',
  burn_rate_warning: '📈',
  auto_rotation: '🔄',
}

/**
 * Format activity events for terminal display.
 */
export function formatActivity(events: ActivityEvent[]): string {
  if (events.length === 0) return '  No activity yet.'

  return events
    .map((e) => {
      const icon = TYPE_ICONS[e.type] || '●'
      const time = timeAgo(e.timestamp).padEnd(10)
      return `  ${time} ${icon} ${e.message}`
    })
    .join('\n')
}
