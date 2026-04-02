import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import type { SessionState } from '../types.js'

const IMPACT_DIR = resolve(homedir(), '.clauditor')
const IMPACT_FILE = resolve(IMPACT_DIR, 'impact.json')

export interface ImpactStats {
  firstSeen: string
  lastUpdated: string
  sessionsMonitored: number
  cacheIssuesCaught: number
  loopsDetected: number
  resumeAnomaliesCaught: number
  contextOverflowWarnings: number
  editThrashingCaught: number
  // Measurable data — things we can prove from JSONL
  totalTurnsMonitored: number
  healthySessionPct: number
  avgCacheRatio: number
  compactionsSaved: number
  // Track which sessions we've already counted to avoid double-counting
  countedSessions: string[]
}

const EMPTY_STATS: ImpactStats = {
  firstSeen: new Date().toISOString(),
  lastUpdated: new Date().toISOString(),
  sessionsMonitored: 0,
  cacheIssuesCaught: 0,
  loopsDetected: 0,
  resumeAnomaliesCaught: 0,
  contextOverflowWarnings: 0,
  editThrashingCaught: 0,
  totalTurnsMonitored: 0,
  healthySessionPct: 0,
  avgCacheRatio: 0,
  compactionsSaved: 0,
  countedSessions: [],
}

export async function loadImpactStats(): Promise<ImpactStats> {
  try {
    const content = await readFile(IMPACT_FILE, 'utf-8')
    return { ...EMPTY_STATS, ...JSON.parse(content) }
  } catch {
    return { ...EMPTY_STATS }
  }
}

export async function saveImpactStats(stats: ImpactStats): Promise<void> {
  await mkdir(IMPACT_DIR, { recursive: true })
  stats.lastUpdated = new Date().toISOString()
  await writeFile(IMPACT_FILE, JSON.stringify(stats, null, 2) + '\n')
}

/**
 * Update impact stats from a batch of sessions.
 * Only counts each session once (by filePath).
 */
export function updateImpactFromSessions(
  stats: ImpactStats,
  sessions: SessionState[]
): ImpactStats {
  const updated = { ...stats }
  const counted = new Set(stats.countedSessions)

  for (const session of sessions) {
    if (counted.has(session.filePath)) continue
    counted.add(session.filePath)

    updated.sessionsMonitored++

    if (session.cacheHealth.degradationDetected || session.cacheHealth.status === 'degraded') {
      updated.cacheIssuesCaught++
    }

    if (session.loopState.loopDetected) {
      updated.loopsDetected++
    }

    if (session.resumeAnomaly.detected) {
      updated.resumeAnomaliesCaught++
    }

    // Check for context overflow (>= 90% of limit)
    const lastTurn = session.turns[session.turns.length - 1]
    if (lastTurn) {
      const contextSize =
        lastTurn.usage.input_tokens +
        lastTurn.usage.cache_creation_input_tokens +
        lastTurn.usage.cache_read_input_tokens
      const isOpus = session.model?.includes('opus') ?? false
      const limit = isOpus ? 1_000_000 : 200_000
      if (contextSize / limit >= 0.9) {
        updated.contextOverflowWarnings++
      }
    }

  }

  // Recompute aggregate KPIs from ALL sessions (not just new ones)
  // These are recalculated fresh every time to stay accurate
  let healthyCount = 0
  let totalRatio = 0
  let sessionsWithRatio = 0
  let totalTurns = 0

  for (const session of sessions) {
    totalTurns += session.turns.length

    if (session.turns.length >= 3) {
      sessionsWithRatio++
      totalRatio += session.cacheHealth.lastCacheRatio
      if (session.cacheHealth.status === 'healthy') {
        healthyCount++
      }
    }
  }

  updated.totalTurnsMonitored = totalTurns
  updated.healthySessionPct = sessionsWithRatio > 0
    ? Math.round((healthyCount / sessionsWithRatio) * 100)
    : 0
  updated.avgCacheRatio = sessionsWithRatio > 0
    ? totalRatio / sessionsWithRatio
    : 0

  updated.countedSessions = Array.from(counted)
  return updated
}

/**
 * Format impact stats for terminal display.
 */
export function formatImpactStats(stats: ImpactStats): string {
  const lines: string[] = []
  const daysSince = Math.max(
    1,
    Math.floor((Date.now() - new Date(stats.firstSeen).getTime()) / 86_400_000)
  )

  lines.push('clauditor impact')
  lines.push('─'.repeat(55))

  // Overview
  lines.push(`  Monitoring since: ${new Date(stats.firstSeen).toLocaleDateString()}  (${daysSince} day${daysSince === 1 ? '' : 's'})`)
  lines.push(`  Sessions monitored: ${stats.sessionsMonitored}`)
  lines.push(`  Total turns tracked: ${stats.totalTurnsMonitored.toLocaleString()}`)
  lines.push('')

  // Session health — the headline KPIs
  lines.push('  SESSION HEALTH')
  lines.push('  ──────────────')
  lines.push(`  Healthy sessions:     ${stats.healthySessionPct}%`)
  lines.push(`  Average cache ratio:  ${(stats.avgCacheRatio * 100).toFixed(1)}%`)
  lines.push('')

  // Issues caught — what clauditor did
  const totalIssues =
    stats.cacheIssuesCaught +
    stats.loopsDetected +
    stats.resumeAnomaliesCaught +
    stats.contextOverflowWarnings +
    stats.editThrashingCaught

  lines.push('  ISSUES CAUGHT')
  lines.push('  ─────────────')

  if (totalIssues === 0) {
    lines.push('  No issues detected — your sessions have been healthy.')
  } else {
    if (stats.cacheIssuesCaught > 0) {
      lines.push(`  ${stats.cacheIssuesCaught} cache degradation${stats.cacheIssuesCaught === 1 ? '' : 's'}     — sessions reprocessing context from scratch`)
    }
    if (stats.loopsDetected > 0) {
      lines.push(`  ${stats.loopsDetected} loop${stats.loopsDetected === 1 ? '' : 's'} blocked            — Claude retrying the same failing action`)
    }
    if (stats.resumeAnomaliesCaught > 0) {
      lines.push(`  ${stats.resumeAnomaliesCaught} resume anomal${stats.resumeAnomaliesCaught === 1 ? 'y' : 'ies'}         — token explosion or cache break on resume`)
    }
    if (stats.contextOverflowWarnings > 0) {
      lines.push(`  ${stats.contextOverflowWarnings} context save${stats.contextOverflowWarnings === 1 ? '' : 's'}          — saved progress before compaction`)
    }
    if (stats.editThrashingCaught > 0) {
      lines.push(`  ${stats.editThrashingCaught} edit thrash${stats.editThrashingCaught === 1 ? '' : 'es'} redirected  — Claude stopped and asked to rethink approach`)
    }
    lines.push('')
    lines.push(`  Total: ${totalIssues} issue${totalIssues === 1 ? '' : 's'} caught across ${stats.sessionsMonitored} sessions`)
  }

  return lines.join('\n')
}
