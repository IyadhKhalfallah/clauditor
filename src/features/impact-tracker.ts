import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import type { SessionState } from '../types.js'
import { readActivity } from './activity-log.js'

const IMPACT_DIR = resolve(homedir(), '.clauditor')
const IMPACT_FILE = resolve(IMPACT_DIR, 'impact.json')

export interface ImpactStats {
  firstSeen: string
  lastUpdated: string
  // From session scans (detected)
  sessionsMonitored: number
  totalTurnsMonitored: number
  healthySessionPct: number
  avgCacheRatio: number
  // Detected in historical data
  detected: {
    cacheIssues: number
    loops: number
    resumeAnomalies: number
    contextOverflows: number
  }
  // Track which sessions we've already counted
  countedSessions: string[]
}

const EMPTY_STATS: ImpactStats = {
  firstSeen: new Date().toISOString(),
  lastUpdated: new Date().toISOString(),
  sessionsMonitored: 0,
  totalTurnsMonitored: 0,
  healthySessionPct: 0,
  avgCacheRatio: 0,
  detected: {
    cacheIssues: 0,
    loops: 0,
    resumeAnomalies: 0,
    contextOverflows: 0,
  },
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
  const updated = { ...stats, detected: { ...stats.detected } }
  const counted = new Set(stats.countedSessions)

  for (const session of sessions) {
    if (counted.has(session.filePath)) continue
    counted.add(session.filePath)

    updated.sessionsMonitored++

    if (session.cacheHealth.degradationDetected || session.cacheHealth.status === 'degraded') {
      updated.detected.cacheIssues++
    }

    if (session.loopState.loopDetected) {
      updated.detected.loops++
    }

    if (session.resumeAnomaly.detected) {
      updated.detected.resumeAnomalies++
    }

    const lastTurn = session.turns[session.turns.length - 1]
    if (lastTurn) {
      const contextSize =
        lastTurn.usage.input_tokens +
        lastTurn.usage.cache_creation_input_tokens +
        lastTurn.usage.cache_read_input_tokens
      const isOpus = session.model?.includes('opus') ?? false
      const limit = isOpus ? 1_000_000 : 200_000
      if (contextSize / limit >= 0.9) {
        updated.detected.contextOverflows++
      }
    }
  }

  // Recompute aggregate KPIs from ALL sessions
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
 * Splits into "detected" (from scans) and "actions taken" (from activity log).
 */
export async function formatImpactStats(stats: ImpactStats): Promise<string> {
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

  // Session health
  lines.push('  SESSION HEALTH')
  lines.push('  ──────────────')
  lines.push(`  Healthy sessions:     ${stats.healthySessionPct}%`)
  lines.push(`  Average cache ratio:  ${(stats.avgCacheRatio * 100).toFixed(1)}%`)
  lines.push('')

  // Actions taken — from the activity log (real actions hooks performed)
  const allActivity = await readActivity(1000)
  const actions = {
    cacheWarnings: allActivity.filter((e) => e.type === 'cache_warning').length,
    loopsBlocked: allActivity.filter((e) => e.type === 'loop_blocked').length,
    resumeWarnings: allActivity.filter((e) => e.type === 'resume_warning').length,
    contextWarnings: allActivity.filter((e) => e.type === 'context_warning').length,
    bashCompressions: allActivity.filter((e) => e.type === 'bash_compressed').length,
    notifications: allActivity.filter((e) => e.type === 'notification').length,
  }
  const totalActions = Object.values(actions).reduce((a, b) => a + b, 0)

  lines.push('  ACTIONS TAKEN (by hooks, in real-time)')
  lines.push('  ──────────────────────────────────────')

  if (totalActions === 0) {
    lines.push('  No actions yet — hooks will act when issues occur during your sessions.')
    lines.push('  Use Claude Code normally. clauditor works in the background.')
  } else {
    if (actions.cacheWarnings > 0)
      lines.push(`  ${actions.cacheWarnings} cache warning${actions.cacheWarnings === 1 ? '' : 's'} injected       — told Claude to suggest /clear`)
    if (actions.loopsBlocked > 0)
      lines.push(`  ${actions.loopsBlocked} loop${actions.loopsBlocked === 1 ? '' : 's'} blocked              — stopped Claude from repeating failures`)
    if (actions.resumeWarnings > 0)
      lines.push(`  ${actions.resumeWarnings} resume warning${actions.resumeWarnings === 1 ? '' : 's'} injected   — warned about resume bugs`)
    if (actions.contextWarnings > 0)
      lines.push(`  ${actions.contextWarnings} context save${actions.contextWarnings === 1 ? '' : 's'} triggered     — saved progress before compaction`)
    if (actions.bashCompressions > 0)
      lines.push(`  ${actions.bashCompressions} bash output${actions.bashCompressions === 1 ? '' : 's'} compressed   — reduced noisy tool output`)
    if (actions.notifications > 0)
      lines.push(`  ${actions.notifications} desktop notification${actions.notifications === 1 ? '' : 's'}     — alerted you to problems`)
  }

  // Issues detected — from historical session scan
  const totalDetected =
    stats.detected.cacheIssues +
    stats.detected.loops +
    stats.detected.resumeAnomalies +
    stats.detected.contextOverflows

  lines.push('')
  lines.push('  ISSUES DETECTED (from session history)')
  lines.push('  ──────────────────────────────────────')

  if (totalDetected === 0) {
    lines.push('  No issues found in session history — your sessions have been healthy.')
  } else {
    if (stats.detected.cacheIssues > 0)
      lines.push(`  ${stats.detected.cacheIssues} session${stats.detected.cacheIssues === 1 ? '' : 's'} with cache degradation`)
    if (stats.detected.loops > 0)
      lines.push(`  ${stats.detected.loops} session${stats.detected.loops === 1 ? '' : 's'} with loop patterns`)
    if (stats.detected.resumeAnomalies > 0)
      lines.push(`  ${stats.detected.resumeAnomalies} session${stats.detected.resumeAnomalies === 1 ? '' : 's'} with resume anomalies`)
    if (stats.detected.contextOverflows > 0)
      lines.push(`  ${stats.detected.contextOverflows} session${stats.detected.contextOverflows === 1 ? '' : 's'} near context limit`)
  }

  // Knowledge & subagent intelligence (local data)
  try {
    const knowledgeLines = await formatKnowledgeStats()
    if (knowledgeLines.length > 0) {
      lines.push('')
      lines.push(...knowledgeLines)
    }
  } catch {}

  return lines.join('\n')
}

/**
 * Gather knowledge and subagent stats from local data.
 */
async function formatKnowledgeStats(): Promise<string[]> {
  const lines: string[] = []
  const cwd = process.cwd()

  // Error/fix pairs
  try {
    const { readdirSync, readFileSync, existsSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const { homedir } = await import('node:os')

    const knowledgeDir = resolve(homedir(), '.clauditor', 'knowledge')
    if (existsSync(knowledgeDir)) {
      let totalErrors = 0
      let totalWithFix = 0
      const dirs = readdirSync(knowledgeDir, { withFileTypes: true })
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue
        const errorsPath = resolve(knowledgeDir, dir.name, 'errors.json')
        if (!existsSync(errorsPath)) continue
        try {
          const data = JSON.parse(readFileSync(errorsPath, 'utf-8'))
          const entries = Object.values(data) as Array<{ fix?: string; fixCommands?: string[] }>
          totalErrors += entries.length
          totalWithFix += entries.filter(e => e.fix || (e.fixCommands && e.fixCommands.length > 0)).length
        } catch {}
      }

      if (totalErrors > 0) {
        lines.push('  KNOWLEDGE (local)')
        lines.push('  ─────────────────')
        lines.push(`  Error/fix pairs:      ${totalErrors} recorded (${totalWithFix} with fixes)`)
      }
    }
  } catch {}

  // Subagent intelligence
  try {
    const { scanSubagents, detectPatterns } = await import('./subagent-intel.js')
    const summary = scanSubagents(cwd)

    if (summary.total > 0) {
      if (lines.length === 0) {
        lines.push('  KNOWLEDGE (local)')
        lines.push('  ─────────────────')
      }
      lines.push(`  Subagents spawned:    ${summary.total} across ${new Set(summary.signals.map(s => s.sessionId)).size} sessions`)

      // Top categories
      const sorted = Object.entries(summary.byCategory)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
      if (sorted.length > 0) {
        lines.push(`  Top agent tasks:      ${sorted.map(([k, v]) => `${k} (${v})`).join(', ')}`)
      }

      // Recurring patterns
      const patterns = detectPatterns(summary.signals)
      if (patterns.length > 0) {
        lines.push(`  Recurring patterns:   ${patterns.length} detected`)
        for (const p of patterns.slice(0, 2)) {
          lines.push(`    ${p.count}x "${p.descriptions[0]}"`)
        }
      }
    }
  } catch {}

  // Hub stats (if configured)
  try {
    const { resolveHubContext } = await import('../hub/client.js')
    const hub = resolveHubContext(cwd)
    if (hub) {
      const [memRes, subRes] = await Promise.all([
        fetch(`${hub.config.url}/api/v1/memory/query?project_hash=${hub.projectHash}`, {
          headers: { 'X-Clauditor-Key': hub.config.apiKey },
        }).catch(() => null),
        fetch(`${hub.config.url}/api/v1/subagents/query?project_hash=${hub.projectHash}`, {
          headers: { 'X-Clauditor-Key': hub.config.apiKey },
        }).catch(() => null),
      ])

      const memData = memRes?.ok ? await memRes.json() as { count: number } : null
      const subData = subRes?.ok ? await subRes.json() as { summary: { total: number; by_category: Record<string, number> } } : null

      if (memData || subData) {
        lines.push('')
        lines.push('  TEAM HUB')
        lines.push('  ────────')
        if (memData && memData.count > 0)
          lines.push(`  Team memories shared: ${memData.count}`)
        if (subData && subData.summary.total > 0)
          lines.push(`  Subagent signals:     ${subData.summary.total}`)
      }
    }
  } catch {}

  return lines
}
