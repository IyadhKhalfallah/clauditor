import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, sep, basename } from 'node:path'

export interface SessionReport {
  file: string
  label: string
  turns: number
  baselineK: number
  currentK: number
  wasteFactor: number
  totalTokens: number
  date: Date
}

export interface QuotaBrief {
  totalSessions: number
  totalTokens: number
  sessionsOver3x: number
  sessionsOver5x: number
  worstSession: SessionReport | null
  sessions: SessionReport[]
  /** Estimated tokens if every session was rotated at optimal points */
  tokensWithRotation: number
  /** Number of sessions where clauditor actually blocked */
  sessionsBlocked: number
}

/**
 * Analyze all sessions across all projects for the last N days.
 * Deduplicates continued sessions by message ID.
 */
export function computeQuotaBrief(days: number = 7): QuotaBrief {
  const projectsDir = resolve(homedir(), '.claude/projects')
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const sessions: SessionReport[] = []
  const seenMessageIds = new Set<string>()

  let projectDirs: string[]
  try {
    projectDirs = readdirSync(projectsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
  } catch {
    return { totalSessions: 0, totalTokens: 0, sessionsOver3x: 0, sessionsOver5x: 0, worstSession: null, sessions: [], tokensWithRotation: 0, sessionsBlocked: 0 }
  }

  for (const projDir of projectDirs) {
    const projPath = resolve(projectsDir, projDir)
    let files: string[]
    try {
      files = readdirSync(projPath).filter(f => f.endsWith('.jsonl'))
    } catch {
      continue
    }

    // Derive a human label from the encoded project path
    const label = projDir
      .replace(/^-/, '')
      .split('-')
      .slice(-2)
      .join('/')

    for (const file of files) {
      const filePath = resolve(projPath, file)
      try {
        const stat = statSync(filePath)
        if (stat.mtime < cutoff) continue

        const report = analyzeSessionFile(filePath, label, seenMessageIds)
        if (report) sessions.push(report)
      } catch {
        continue
      }
    }
  }

  sessions.sort((a, b) => b.wasteFactor - a.wasteFactor)

  const totalTokens = sessions.reduce((s, r) => s + r.totalTokens, 0)

  // Estimate what tokens would be with rotation:
  // If a session has waste factor W and T turns, rotating every 30 turns
  // means each chunk starts fresh at baseline. Rough estimate:
  // rotated cost ≈ turns × baseline × 2 (avg growth within each 30-turn chunk)
  const tokensWithRotation = sessions.reduce((s, r) => {
    if (r.wasteFactor <= 2) return s + r.totalTokens // already efficient
    return s + r.turns * r.baselineK * 2 * 1000
  }, 0)

  // Count blocked sessions from activity log
  let sessionsBlocked = 0
  try {
    const activityPath = resolve(homedir(), '.clauditor', 'activity.log')
    const activityContent = readFileSync(activityPath, 'utf-8')
    const cutoffTime = cutoff.getTime()
    for (const line of activityContent.split('\n')) {
      if (!line) continue
      try {
        const event = JSON.parse(line)
        if (new Date(event.timestamp).getTime() < cutoffTime) continue
        if (event.message && event.message.includes('BLOCKED')) sessionsBlocked++
      } catch {}
    }
  } catch {}

  return {
    totalSessions: sessions.length,
    totalTokens,
    sessionsOver3x: sessions.filter(s => s.wasteFactor >= 3).length,
    sessionsOver5x: sessions.filter(s => s.wasteFactor >= 5).length,
    worstSession: sessions[0] || null,
    sessions,
    tokensWithRotation,
    sessionsBlocked,
  }
}

function analyzeSessionFile(
  filePath: string,
  label: string,
  seenMessageIds: Set<string>
): SessionReport | null {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n').filter(Boolean)

  const turnTotals: number[] = []
  let totalTokens = 0
  let isAllDuplicate = true
  let lastTimestamp: string | null = null

  for (const line of lines) {
    try {
      const r = JSON.parse(line)
      if (r.type === 'assistant' && r.message?.usage) {
        const msgId = r.message?.id
        if (msgId && seenMessageIds.has(msgId)) {
          continue // skip duplicate turns from continued sessions
        }
        if (msgId) {
          seenMessageIds.add(msgId)
          isAllDuplicate = false
        }

        const u = r.message.usage
        const total = (u.input_tokens || 0) + (u.output_tokens || 0) +
          (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
        turnTotals.push(total)
        totalTokens += total
        if (r.timestamp) lastTimestamp = r.timestamp
      }
    } catch {
      // skip malformed lines
    }
  }

  // Skip files that are entirely duplicate (continuation with no new turns)
  if (isAllDuplicate && turnTotals.length === 0) return null
  if (turnTotals.length < 3) return null

  const baseline = turnTotals.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(5, turnTotals.length)
  const current = turnTotals.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, turnTotals.length)
  const wasteFactor = baseline > 0 ? Math.round((current / baseline) * 10) / 10 : 1

  return {
    file: basename(filePath).replace('.jsonl', '').slice(0, 8),
    label,
    turns: turnTotals.length,
    baselineK: Math.round(baseline / 1000),
    currentK: Math.round(current / 1000),
    wasteFactor,
    totalTokens,
    date: lastTimestamp ? new Date(lastTimestamp) : new Date(),
  }
}
