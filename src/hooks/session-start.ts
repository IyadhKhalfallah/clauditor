import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { readdir, stat } from 'node:fs/promises'
import type { HookDecision } from '../types.js'
import { parseJsonlFile, extractTurns, extractModel } from '../daemon/parser.js'
import { detectCacheDegradation } from '../features/cache-health.js'
import { hasResumeBoundary, detectResumeAnomaly } from '../features/resume-detector.js'
import { logActivity } from '../features/activity-log.js'
import { readStdin, outputDecision, pruneStaleStateFiles } from './shared.js'

/**
 * SessionStart hook handler.
 *
 * Fires when Claude Code starts a new session. Checks recent session
 * history and injects context about:
 * - Previous session health issues
 * - Whether the last session was resumed (and if resume caused problems)
 * - Saved context from CLAUDE.md (reminds Claude to read it)
 *
 * This is infrastructure, not information — Claude acts on it automatically.
 */
export async function handleSessionStartHook(): Promise<void> {
  const input = await readStdin()
  let hookInput: { session_id: string; cwd?: string }
  try {
    hookInput = JSON.parse(input)
  } catch {
    outputDecision({})
    return
  }

  // Prune stale state files — lightweight, runs once per session start
  try { pruneStaleStateFiles() } catch {}

  const context = await buildSessionStartContext(hookInput.cwd)
  outputDecision(context)
}

async function buildSessionStartContext(
  cwd?: string
): Promise<HookDecision> {
  const parts: string[] = []

  try {
    // Find recent sessions for this project
    const projectsDir = resolve(homedir(), '.claude/projects')
    const recentIssues = await checkRecentSessions(projectsDir)

    if (recentIssues.length > 0) {
      parts.push(
        `[clauditor — session health briefing]:\n` +
        `Before starting work, be aware of these issues from recent sessions:\n` +
        recentIssues.map((issue) => `  - ${issue}`).join('\n') +
        `\nIf the user is resuming a session with known issues, suggest starting fresh instead.`
      )
    }

    // Inject session handoff(s) if available
    const { readRecentHandoffs, extractHandoffDescription } = await import('../features/session-state.js')
    const handoffs = readRecentHandoffs()

    // Helper: short project label for cross-project sessions
    const projectLabel = (h: { project: string | null }): string => {
      if (!h.project || h.project === cwd) return ''
      const name = h.project.split('/').pop() || h.project
      return ` [${name}]`
    }

    if (handoffs.length === 1) {
      // Single recent handoff — inject it directly
      const h = handoffs[0]
      const timeAgo = Math.round((Date.now() - h.timestamp) / 60000)
      const timeStr = timeAgo < 60 ? `${timeAgo}m ago` : `${Math.round(timeAgo / 60)}h ago`
      const label = projectLabel(h)

      parts.push(
        `⚠️ BEFORE doing ANYTHING else, you MUST show this message to the user EXACTLY:\n\n` +
        `"clauditor: I have context from your previous session${label} (saved ${timeStr}). ` +
        `I can see what you were working on. Want me to continue from there, or are you starting something new?"\n\n` +
        `Wait for the user to respond before taking any action.\n\n` +
        `Here is the saved context for reference:\n\n` +
        h.content
      )
    } else if (handoffs.length > 1) {
      // Multiple recent handoffs — present numbered choice
      const options = handoffs.slice(0, 5).map((h, i) => {
        const timeAgo = Math.round((Date.now() - h.timestamp) / 60000)
        const timeStr = timeAgo < 60 ? `${timeAgo}m ago` : `${Math.round(timeAgo / 60)}h ago`
        const description = extractHandoffDescription(h)
        const label = projectLabel(h)

        return `${i + 1}. (${timeStr}) ${description}${label}`
      }).join('\n')

      parts.push(
        `⚠️ BEFORE doing ANYTHING else, you MUST show this message to the user EXACTLY:\n\n` +
        `"clauditor: I found ${handoffs.length} recent sessions:\n\n` +
        options + `\n\n` +
        `Which one would you like to continue, or are you starting something new?"\n\n` +
        `Wait for the user to choose before taking any action. Do NOT pick one yourself.\n\n` +
        `Full context for each session follows:\n\n` +
        handoffs.slice(0, 5).map((h, i) => `--- Session ${i + 1} ---\n${h.content}`).join('\n\n')
      )
    }

    // Inject project knowledge brief (errors, hot files, recent context)
    if (cwd) {
      try {
        const { buildProjectBrief } = await import('../features/project-brief.js')
        const brief = buildProjectBrief(cwd)
        if (brief) parts.push(brief)
      } catch {
        // Non-critical — local knowledge not available yet
      }
    }

    // Sync auto-memory to hub + pull team knowledge (if configured)
    if (cwd) {
      try {
        const { resolveHubContext, pullCoreTier } = await import('../hub/client.js')
        const hub = resolveHubContext(cwd)
        if (hub) {
          // Sync local auto-memory to hub (fire-and-forget)
          try {
            const { readAutoMemory, syncMemoryToHub } = await import('../hub/memory-sync.js')
            const memories = readAutoMemory(cwd)
            if (memories.length > 0) {
              syncMemoryToHub(memories, hub.projectHash, hub.config.developerHash, hub.config).catch(() => {})
            }
          } catch {}

          // Pull team knowledge
          const core = await pullCoreTier(hub.projectHash, hub.config)
          if (core?.core) {
            parts.push(
              `[clauditor hub — team knowledge]:\n` +
              core.core
            )
          }
        }
      } catch {
        // Hub unavailable — local knowledge is enough
      }
    }

    // CLAUDE.md reminder removed — Claude Code loads CLAUDE.md automatically.
    // Injecting a reminder wastes tokens without preventing mistakes.
    // Check for repeating workflows that could become skills
    const { SessionStore } = await import('../daemon/store.js')
    const { SessionWatcher } = await import('../daemon/watcher.js')
    const { detectWorkflowPatterns, generateSkillSuggestions } = await import('../features/skill-suggest.js')

    const store = new SessionStore()
    const watcher = new SessionWatcher(store, { projectsDir })
    await watcher.scanAll()

    const sessions = store.getAll()
    const patterns = detectWorkflowPatterns(sessions)
    const suggestions = generateSkillSuggestions(patterns)

    if (suggestions.length > 0) {
      // Only inject the top suggestion to avoid noise
      parts.push(suggestions[0].prompt)
    }
  } catch {
    // Non-critical
  }

  if (parts.length > 0) {
    logActivity({
      type: 'notification',
      session: 'startup',
      message: `Session start: injected briefing (${parts.length} items${parts.length > 1 ? ', includes skill suggestion' : ''})`,
    }).catch(() => {})
  }

  if (parts.length === 0) return {}
  return { additionalContext: parts.join('\n\n') }
}

/**
 * Scan recent sessions for health issues worth warning about.
 */
async function checkRecentSessions(projectsDir: string): Promise<string[]> {
  const issues: string[] = []
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000

  try {
    const projectDirs = await readdir(projectsDir, { withFileTypes: true })

    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue
      const projectPath = resolve(projectsDir, dir.name)

      try {
        const files = await readdir(projectPath)
        const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'))

        // Only check the 5 most recent files to keep startup fast
        const fileStats = await Promise.all(
          jsonlFiles.slice(0, 10).map(async (f) => {
            const fullPath = resolve(projectPath, f)
            try {
              const s = await stat(fullPath)
              return { path: fullPath, mtime: s.mtimeMs }
            } catch {
              return null
            }
          })
        )

        const recent = fileStats
          .filter((f): f is NonNullable<typeof f> => f !== null && f.mtime > oneDayAgo)
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, 5)

        for (const file of recent) {
          try {
            const records = await parseJsonlFile(file.path)
            const turns = extractTurns(records)
            if (turns.length < 3) continue

            const cacheHealth = detectCacheDegradation(turns)
            if (cacheHealth.degradationDetected) {
              issues.push(
                `A recent session had broken cache (${(cacheHealth.lastCacheRatio * 100).toFixed(0)}% hit ratio). ` +
                `If resuming it, expect slow responses and high quota usage.`
              )
            }

            const isResumed = hasResumeBoundary(records)
            if (isResumed) {
              const anomaly = detectResumeAnomaly(turns, true)
              if (anomaly.detected) {
                issues.push(
                  `A recent resumed session had anomalies (${anomaly.outputTokenSpike ? 'token explosion' : 'cache invalidation'}). ` +
                  `Starting fresh is safer than resuming.`
                )
              }
            }
          } catch {
            continue
          }
        }
      } catch {
        continue
      }
    }
  } catch {
    // Projects dir may not exist
  }

  // Deduplicate and limit
  return [...new Set(issues)].slice(0, 3)
}

// Run if invoked directly
handleSessionStartHook().catch((err) => {
  process.stderr.write(`clauditor session-start hook error: ${err}\n`)
  process.stdout.write('{}')
  process.exit(0)
})
