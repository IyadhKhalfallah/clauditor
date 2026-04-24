import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { PostToolUseHookInput, HookDecision, TurnMetrics } from '../types.js'
import { compressToolOutput } from '../features/output-compressor.js'
import { isTurbo, TURBO_THRESHOLDS } from '../config.js'
import { recordError, recordFix, recordOutcome, extractBaseCommand, trackCommand, clearCommandBuffer } from '../features/error-index.js'
import { readOutcomePending, clearOutcomePending } from './pre-tool-use.js'
import { recordFileEdit, recordFileRead, getFileContext } from '../features/file-tracker.js'
import { parseJsonlFile, extractTurns } from '../daemon/parser.js'
import { detectCacheDegradation } from '../features/cache-health.js'
import { hasResumeBoundary } from '../features/resume-detector.js'
import { detectResumeAnomaly } from '../features/resume-detector.js'
import { estimateQuotaBurnRate } from '../features/quota-burn.js'
import { logActivity } from '../features/activity-log.js'
import { saveSessionState, extractSessionStateFromTranscript, findTranscriptPathSync as findTranscriptSync } from '../features/session-state.js'
import { readConfig } from '../config.js'
import { loadCalibration } from '../features/calibration.js'
import { readStdin, outputDecision, writeJsonFileAtomic, readJsonFile } from './shared.js'

/**
 * PostToolUse hook handler.
 *
 * Two responsibilities:
 * 1. Compress verbose bash output
 * 2. Inject session health warnings into Claude's context so it can
 *    proactively advise the user (e.g. "your cache is degraded")
 *
 * This is the key integration point — it meets users where they are
 * (inside Claude Code) instead of requiring a separate dashboard.
 */
export async function handlePostToolUseHook(): Promise<void> {
  let hookInput: PostToolUseHookInput
  try {
    const input = await readStdin()
    hookInput = JSON.parse(input) as PostToolUseHookInput
  } catch {
    outputDecision({})
    return
  }

  const decision = await processToolResult(hookInput)

  // If it's a block decision, use exit code 2 — stderr is fed back
  // to Claude as feedback. This is stronger than decision: "block"
  // which Claude can interpret as a tool error and retry.
  if (decision && 'decision' in decision && decision.decision === 'block') {
    process.stderr.write(
      (decision as { reason?: string }).reason ||
      'clauditor: session too large, start a fresh session'
    )
    process.stdout.write('{}')
    process.exit(2)
    return
  }

  outputDecision(decision)
}

async function processToolResult(input: PostToolUseHookInput): Promise<HookDecision> {
  const parts: string[] = []
  const hubPushes: Promise<void>[] = []

  // Fire-and-forget hub push helper — scrubs secrets before sending
  function hubPush(cwd: string | null, fragments: Array<{ type: string; content: Record<string, unknown> }>) {
    if (!cwd) return
    hubPushes.push((async () => {
      try {
        const { resolveHubContext, pushKnowledge } = await import('../hub/client.js')
        const { scrubFragmentContent } = await import('../features/secret-scrubber.js')
        const hub = resolveHubContext(cwd)
        if (!hub) return
        // Scrub every fragment before it leaves the machine
        const scrubbed = fragments.map(f => ({
          type: f.type,
          content: scrubFragmentContent(f.content).content,
        }))
        await pushKnowledge(hub.projectHash, hub.config.developerHash, scrubbed, hub.config, hub.remoteUrl)
      } catch (err) {
        process.stderr.write(`clauditor: hub push failed: ${err instanceof Error ? err.message : err}\n`)
      }
    })())
  }

  // Resolve cwd — may not be provided by Claude Code in all contexts
  const cwd = input.cwd || null


  // 1. Compress verbose tool output. Bash has had compression for a while;
  // Grep/Glob/WebFetch/WebSearch are handled through the same dispatch so
  // we don't burn tokens on 500-line Grep dumps or 50k-char WebFetch blobs.
  const COMPRESSIBLE_TOOLS = new Set(['Bash', 'Grep', 'Glob', 'WebFetch', 'WebSearch'])
  if (COMPRESSIBLE_TOOLS.has(input.tool_name)) {
    const toolResponse = input.tool_response || ''
    const result = compressToolOutput({
      toolName: input.tool_name,
      output: toolResponse,
      toolInput: input.tool_input as Record<string, unknown> | undefined,
    })
    if (result.compressed) {
      parts.push(
        `[clauditor]: ${input.tool_name} output compressed ${formatSize(result.originalLength)} to ${formatSize(result.compressedLength)}.`
      )
      logActivity({
        type: 'bash_compressed',
        session: input.session_id.slice(0, 8),
        message: `Compressed ${input.tool_name} output: ${formatSize(result.originalLength)} to ${formatSize(result.compressedLength)}`,
      }).catch(() => {})
    }
  }

  if (input.tool_name === 'Bash') {
    const toolResponse = input.tool_response || ''

    // Track every command for fix detection
    const cmd = typeof input.tool_input?.command === 'string' ? input.tool_input.command : ''
    if (cwd && cmd) {
      try { trackCommand(cwd, cmd) } catch {}
    }

    // 1b. Post-error guidance. Catch failing commands at attempt 1.
    const errorGuidance = detectBashError(input.session_id, toolResponse)
    if (errorGuidance) {
      parts.push(errorGuidance)
      if (cwd && cmd) {
        try { recordError(cwd, cmd, toolResponse.slice(0, 200)) } catch {}
        try { clearCommandBuffer(cwd) } catch {}
      }
    } else if (cwd && typeof input.tool_input?.command === 'string') {
      // Command succeeded — check if it's a fix for a recent error
      try {
        const fixResult = recordFix(cwd, input.tool_input.command)
        if (fixResult) {
          // Push the fix as a durable knowledge entry (not a fragment)
          hubPushes.push((async () => {
            try {
              const { resolveHubContext } = await import('../hub/client.js')
              const { scrubSecrets } = await import('../features/secret-scrubber.js')
              const hub = resolveHubContext(cwd)
              if (!hub) return
              const { queueAndSend } = await import('../hub/push-queue.js')
              await queueAndSend(
                `${hub.config.url}/api/v1/handoff/learn`,
                { 'X-Clauditor-Key': hub.config.apiKey, 'Content-Type': 'application/json' },
                {
                  project_hash: hub.projectHash,
                  developer_hash: hub.config.developerHash,
                  project_name: hub.remoteUrl,
                  learnings: [{
                    type: 'error_fix',
                    content: scrubSecrets(`${fixResult.command} failed with: ${fixResult.error}\nFix: ${fixResult.fix}`).scrubbed,
                  }],
                }
              )
            } catch (err) {
              process.stderr.write(`clauditor: error-fix hub push failed: ${err instanceof Error ? err.message : err}\n`)
            }
          })())
        }
      } catch (err) {
        process.stderr.write(`clauditor: error capture failed: ${err instanceof Error ? err.message : err}\n`)
      }
    }

    // Push errors to hub (local recording already handled above)
    const command = typeof input.tool_input?.command === 'string' ? input.tool_input.command : ''
    if (command && toolResponse && (toolResponse.includes('error') || toolResponse.includes('Error') || toolResponse.includes('FAILED'))) {
      hubPush(cwd, [{
        type: 'error',
        content: { command: command.slice(0, 200), error_message: toolResponse.slice(0, 500) },
      }])
    }

    // 1c. Implicit outcome tracking — did a PreToolUse warning lead to success or failure?
    if (cwd && command) {
      try {
        const pending = readOutcomePending()
        if (pending && extractBaseCommand(command) === extractBaseCommand(pending.command)) {
          const isError = !!errorGuidance
          const outcome = isError ? 'negative' : 'positive'

          // Update local confidence
          recordOutcome(cwd, command, outcome)

          // Push outcome to hub if entry IDs are available
          if (pending.hubEntryIds && pending.hubEntryIds.length > 0) {
            hubPushes.push((async () => {
              try {
                const { resolveHubContext } = await import('../hub/client.js')
                const hub = resolveHubContext(cwd)
                if (!hub) return
                await fetch(`${hub.config.url}/api/v1/knowledge/outcome`, {
                  method: 'POST',
                  headers: { 'X-Clauditor-Key': hub.config.apiKey, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ entry_ids: pending.hubEntryIds, outcome }),
                  signal: AbortSignal.timeout(10000),
                })
              } catch (err) {
                process.stderr.write(`clauditor: outcome push failed: ${err instanceof Error ? err.message : err}\n`)
              }
            })())
          }

          clearOutcomePending()
        }
      } catch {}
    }
  }

  // 2. Detect repeated edits to the same file — a sign of thrashing
  if (input.tool_name === 'Edit' || input.tool_name === 'Write') {
    const filePath = (input.tool_input?.file_path as string) || ''
    if (filePath) {
      const editWarning = trackFileEdits(input.session_id, filePath)
      if (editWarning) {
        parts.push(editWarning)
      }
      // Track file edit in project knowledge
      if (cwd) {
        try { recordFileEdit(cwd, filePath, input.session_id) } catch {}
      }
      // File activity NOT pushed to hub — low signal, high volume.
      // 96% of hub fragments were file_activity producing only noise entries.
      // Local file tracker handles this instead.
    }
  }

  // 2b. Track file reads + inject context for hot files + error cross-reference
  if (input.tool_name === 'Read') {
    const filePath = (input.tool_input?.file_path as string) || ''
    if (filePath && cwd) {
      try { recordFileRead(cwd, filePath, input.session_id) } catch {}
      // Inject context for hot files (5+ edits, 3+ sessions), once per session per file
      const fileCtx = getFileContext(cwd, filePath, input.session_id)
      if (fileCtx) {
        parts.push(fileCtx)
      }
      // Cross-reference: known errors involving this file
      try {
        const { readErrorIndex } = await import('../features/error-index.js')
        const errors = readErrorIndex(cwd)
        const fileName = filePath.split('/').pop() || ''
        const related = errors.filter((e) =>
          e.fix && (e.command.includes(fileName) || e.error.includes(fileName))
        )
        if (related.length > 0) {
          const lines = related.slice(0, 3).map((e) =>
            `- \`${e.command.slice(0, 50)}\`: ${e.error.slice(0, 80)}` +
            (e.fix ? ` → fix: \`${e.fix.slice(0, 60)}\`` : '')
          )
          parts.push(
            `[clauditor]: Known errors related to \`${fileName}\`:\n` + lines.join('\n')
          )
        }
      } catch {}

      // Query hub for team knowledge about this file
      try {
        const { resolveHubContext, queryKnowledge } = await import('../hub/client.js')
        const hub = resolveHubContext(cwd)
        if (hub) {
          const result = await queryKnowledge(hub.projectHash, 'file', filePath, hub.config)
          if (result.entries.length > 0) {
            const lines = result.entries.map((e) => {
              const body = e.body as Record<string, string>
              if (e.entry_type === 'file_role') return `- **${e.title}**: ${body.role || ''}`
              if (e.entry_type === 'convention') return `- **${e.title}**: ${body.pattern || body.description || ''}`
              if (e.entry_type === 'gotcha') return `- **${e.title}**: ${body.description || ''}${body.solution ? ` → ${body.solution}` : ''}`
              return `- **${e.title}** (${e.entry_type})`
            })
            parts.push(
              `[clauditor hub — team knowledge for \`${filePath.split('/').pop()}\`]:\n` + lines.join('\n')
            )
          }
        }
      } catch (err) {
        process.stderr.write(`clauditor: hub file knowledge query failed: ${err instanceof Error ? err.message : err}\n`)
      }
    }
  }

  // 2c. Gotcha injection for Read/View — fire-and-forget, rate-limited per file per session
  if (input.tool_name === 'Read' || input.tool_name === 'View') {
    const filePath = (input.tool_input?.file_path as string) || ''
    if (filePath && cwd && !hasCheckedGotcha(input.session_id, filePath)) {
      markGotchaChecked(input.session_id, filePath)
      // Fire-and-forget: push the gotcha query into hubPushes so we await it
      // before process exit, but don't block the main hook path.
      hubPushes.push((async () => {
        const gotchaCtx = await queryGotchasForFile(cwd, filePath)
        if (gotchaCtx) {
          parts.push(gotchaCtx)
        }
      })())
    }
  }

  // 3. Suggest saving as a skill after a productive session
  const skillNudge = checkSkillNudge(input.session_id, input.tool_name)
  if (skillNudge) {
    parts.push(skillNudge)
  }

  // 4. Check session health (rate-limited to avoid overhead on every call)
  const healthResult = await checkSessionHealth(input.session_id)
  if (healthResult) {
    // If it's a block decision, return immediately — stop Claude
    if ('decision' in healthResult && healthResult.decision === 'block') {
      return healthResult
    }
    // Otherwise it's additionalContext warnings
    if ('additionalContext' in healthResult && healthResult.additionalContext) {
      parts.push(healthResult.additionalContext)
    }
  }

  // Wait for hub pushes before process exits
  if (hubPushes.length > 0) {
    await Promise.allSettled(hubPushes)
  }

  if (parts.length === 0) return {}

  return { additionalContext: parts.join('\n\n') }
}

// ─── Session Health ─────────────────────────────────────────────
// Track when we last checked health per session to avoid checking on every tool call.
// Persisted to disk because each hook invocation is a separate process.
const HEALTH_CHECK_FILE = resolve(homedir(), '.clauditor', 'health-check-ts.json')
const HEALTH_CHECK_INTERVAL_MS = 30_000 // check every 30 seconds — fast enough to catch 20-min burnouts

function writeHealthCheckTimestamp(sessionId: string, now: number): void {
  const data = readJsonFile<Record<string, number>>(HEALTH_CHECK_FILE, {})
  data[sessionId] = now
  try { writeJsonFileAtomic(HEALTH_CHECK_FILE, data) } catch {}
}

async function checkSessionHealth(sessionId: string): Promise<HookDecision | null> {
  const now = Date.now()
  const lastCheck = readJsonFile<Record<string, number>>(HEALTH_CHECK_FILE, {})[sessionId] ?? 0
  if (now - lastCheck < HEALTH_CHECK_INTERVAL_MS) return null
  writeHealthCheckTimestamp(sessionId, now)

  try {
    const transcriptPath = await findTranscriptPath(sessionId)
    if (!transcriptPath) return null

    const records = await parseJsonlFile(transcriptPath)
    const turns = extractTurns(records)
    if (turns.length < 3) return null

    const warnings: string[] = []

    // Check cache health — two levels:
    // 1. "Broken" = strict degradation pattern (flat reads + growing creates + <50%)
    // 2. "Dropping" = ratio dropped significantly in recent turns (e.g. 98% → 68%)
    const cacheHealth = detectCacheDegradation(turns)
    if (cacheHealth.degradationDetected) {
      warnings.push(
        `[clauditor]: Cache broken (hit ratio ${(cacheHealth.lastCacheRatio * 100).toFixed(0)}%, should be >70%). ` +
        `Full history is being reprocessed each turn. Tell the user to run /clear or start a fresh session.`
      )
      logActivity({
        type: 'cache_warning',
        session: sessionId.slice(0, 8),
        message: `Injected cache warning — ratio at ${(cacheHealth.lastCacheRatio * 100).toFixed(0)}%`,
      }).catch(() => {})
    } else if (cacheHealth.status === 'degraded' && turns.length >= 5) {
      // Check for a recent drop — was cache healthy a few turns ago?
      const recentRatios = turns.slice(-6).map((t) => t.cacheRatio)
      const peak = Math.max(...recentRatios.slice(0, 3))
      const current = recentRatios[recentRatios.length - 1]
      const dropped = peak > 0.85 && current < 0.7

      if (dropped) {
        warnings.push(
          `[clauditor]: Cache efficiency dropped from ${(peak * 100).toFixed(0)}% to ${(current * 100).toFixed(0)}% ` +
          `in the last few turns. This is likely temporary — large tool outputs (file reads, verbose bash) ` +
          `can cause a dip that recovers on the next turn. No action needed unless it stays below 70% for 5+ turns.`
        )
        logActivity({
          type: 'cache_warning',
          session: sessionId.slice(0, 8),
          message: `Cache drop detected: ${(peak * 100).toFixed(0)}% → ${(current * 100).toFixed(0)}%`,
        }).catch(() => {})
      }
    }

    // Check Claude Code version for known cache bugs
    const { extractModel, extractVersion, isBuggyCacheVersion } = await import('../daemon/parser.js')
    const ccVersion = extractVersion(records)
    if (ccVersion && isBuggyCacheVersion(ccVersion)) {
      warnings.push(
        `[clauditor WARNING — BUGGY VERSION]: You're running Claude Code ${ccVersion} which has a known prompt caching bug ` +
        `that causes 10-20x token consumption. Run \`claude update\` to upgrade to v2.1.91+ which fixes this. ` +
        `This is likely the #1 cause of your quota burning fast.`
      )
      logActivity({
        type: 'cache_warning',
        session: sessionId.slice(0, 8),
        message: `Buggy CC version detected: ${ccVersion} (cache bug in 2.1.69-2.1.89)`,
      }).catch(() => {})
    }

    // Check context window size — detect model from transcript
    const lastTurn = turns[turns.length - 1]
    const contextSize =
      lastTurn.usage.input_tokens +
      lastTurn.usage.cache_creation_input_tokens +
      lastTurn.usage.cache_read_input_tokens
    // Detect model from the JSONL to get correct context limit
    const model = extractModel(records)
    const isOpus = model?.includes('opus') ?? false
    const contextLimit = isOpus ? 1_000_000 : 200_000
    const pct = Math.round((contextSize / contextLimit) * 100)

    if (pct >= 95) {
      warnings.push(
        `[clauditor]: Context ${pct}% full (${(contextSize / 1000).toFixed(0)}k). Compaction imminent. ` +
        `Before continuing, append a short summary of decisions, files touched, and remaining work to CLAUDE.md, ` +
        `then suggest the user start a fresh session.`
      )
      logActivity({
        type: 'context_warning',
        session: sessionId.slice(0, 8),
        message: `Injected context warning — ${pct}% full (${(contextSize / 1000).toFixed(0)}k tokens)`,
      }).catch(() => {})
    }

    // Check for resume anomaly (#38029, #40524)
    const isResumed = hasResumeBoundary(records)
    if (isResumed) {
      const resumeAnomaly = detectResumeAnomaly(turns, true)
      if (resumeAnomaly.outputTokenSpike) {
        warnings.push(
          `[clauditor]: Resume token explosion: ${(resumeAnomaly.outputTokenSpike / 1000).toFixed(0)}k output tokens in one turn after resume. ` +
          `Known bug; tell the user to start fresh rather than resume.`
        )
        logActivity({
          type: 'resume_warning',
          session: sessionId.slice(0, 8),
          message: `Resume token explosion — ${(resumeAnomaly.outputTokenSpike / 1000).toFixed(0)}k output tokens in one turn`,
        }).catch(() => {})
      }
      if (resumeAnomaly.cacheInvalidatedAfterResume) {
        warnings.push(
          `[clauditor]: Resume invalidated the prompt cache, draining quota 10-20x faster. ` +
          `Tell the user to start fresh rather than resume.`
        )
        logActivity({
          type: 'resume_warning',
          session: sessionId.slice(0, 8),
          message: 'Resume invalidated cache — reprocessing all context each turn',
        }).catch(() => {})
      }
    }

    // Check for token spike — the "my limit was hit in 20 min" detector.
    // Compare the last turn's total tokens against the session average.
    // If a single turn costs 5x+ the average, something is wrong NOW.
    if (turns.length >= 3) {
      const lastTurnTokens =
        lastTurn.usage.input_tokens +
        lastTurn.usage.output_tokens +
        lastTurn.usage.cache_creation_input_tokens +
        lastTurn.usage.cache_read_input_tokens

      const avgTokens = turns.slice(0, -1).reduce((sum, t) => {
        return sum + t.usage.input_tokens + t.usage.output_tokens +
          t.usage.cache_creation_input_tokens + t.usage.cache_read_input_tokens
      }, 0) / (turns.length - 1)

      if (avgTokens > 0 && lastTurnTokens > avgTokens * 5 && lastTurnTokens > 100_000) {
        warnings.push(
          `[clauditor]: Token spike: last turn ${(lastTurnTokens / 1000).toFixed(0)}k tokens ` +
          `(${(lastTurnTokens / avgTokens).toFixed(0)}x session average). Tell the user and offer to start fresh. ` +
          `Likely causes: resume cache invalidation, a large file pulled into context, or a CC version bug.`
        )
        logActivity({
          type: 'burn_rate_warning',
          session: sessionId.slice(0, 8),
          message: `Token spike: ${(lastTurnTokens / 1000).toFixed(0)}k tokens in one turn (${(lastTurnTokens / avgTokens).toFixed(0)}x average)`,
        }).catch(() => {})
      }
    }

    // Check quota burn rate (overall trend)
    const burnRate = estimateQuotaBurnRate(turns)
    if (burnRate.burnRateStatus === 'critical') {
      warnings.push(
        `[clauditor]: High burn rate: ${(burnRate.tokensPerMinute / 1000).toFixed(0)}k tokens/min. ` +
        `Likely cache is broken; consider /clear if cache ratio is low.`
      )
    }

    // SESSION ROTATION — check waste factor.
    // If waste is 10x+, BLOCK the tool result. Claude must stop.
    // This works during autonomous operation when UserPromptSubmit doesn't fire.
    const rotationBlock = checkSessionRotationBlock(sessionId, turns)
    if (rotationBlock) {
      return rotationBlock
    }

    if (warnings.length > 0) {
      return { additionalContext: warnings.join('\n\n') }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Find the transcript path for a session by scanning the projects directory.
 */
async function findTranscriptPath(sessionId: string): Promise<string | null> {
  const projectsDir = resolve(homedir(), '.claude/projects')
  try {
    const { readdir } = await import('node:fs/promises')
    const projectDirs = await readdir(projectsDir, { withFileTypes: true })

    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue
      const candidatePath = resolve(projectsDir, dir.name, `${sessionId}.jsonl`)
      try {
        await readFile(candidatePath, { flag: 'r' })
        return candidatePath
      } catch {
        // Check subagent dirs
        const sessionDirs = await readdir(resolve(projectsDir, dir.name), {
          withFileTypes: true,
        }).catch(() => [])
        for (const subDir of sessionDirs) {
          if (!subDir.isDirectory()) continue
          const subPath = resolve(
            projectsDir, dir.name, subDir.name, 'subagents', `${sessionId}.jsonl`
          )
          try {
            await readFile(subPath, { flag: 'r' })
            return subPath
          } catch {
            continue
          }
        }
      }
    }
  } catch {
    // Projects dir may not exist
  }
  return null
}

/**
 * Detect bash command errors and provide guidance BEFORE Claude retries.
 *
 * This is the proactive version of the loop blocker — catches the problem
 * at attempt 1 instead of attempt 3. Only fires once per unique error
 * per session to avoid nagging.
 */
/**
 * After a productive session (20+ tool calls with diverse tools),
 * nudge Claude to suggest /save-skill. Fires once per session.
 */
const NUDGE_THRESHOLD = 20
const NUDGE_FILE = resolve(homedir(), '.clauditor', 'skill-nudge.json')

function checkSkillNudge(sessionId: string, toolName: string): string | null {
  // Read and update nudge state synchronously (fast, small file)
  const state = readJsonFile<Record<string, { count: number; tools: string[]; nudged: boolean }>>(NUDGE_FILE, {})

  if (!state[sessionId]) {
    state[sessionId] = { count: 0, tools: [], nudged: false }
  }

  const session = state[sessionId]
  session.count++
  if (!session.tools.includes(toolName)) {
    session.tools.push(toolName)
  }

  // Already nudged this session
  if (session.nudged) {
    try { writeJsonFileAtomic(NUDGE_FILE, state) } catch {}
    return null
  }

  // Check if session is productive enough:
  // 20+ tool calls AND at least 3 different tools (not just Read/Read/Read)
  if (session.count >= NUDGE_THRESHOLD && session.tools.length >= 3) {
    session.nudged = true
    try { writeJsonFileAtomic(NUDGE_FILE, state) } catch {}

    return (
      `[clauditor]: Productive session (${session.count} actions, ${session.tools.length} tools). ` +
      `If this workflow is repeatable, ask the user once: "Save this as a /save-skill?"`
    )
  }

  try { writeJsonFileAtomic(NUDGE_FILE, state) } catch {}
  return null
}

/**
 * Session rotation via PostToolUse BLOCK.
 *
 * This fires during autonomous operation when UserPromptSubmit doesn't.
 * Uses decision: "block" to stop Claude after a tool call.
 * Same waste factor logic, but blocks the tool result.
 */
function checkSessionRotationBlock(sessionId: string, turns: TurnMetrics[]): HookDecision | null {
  const config = readConfig()
  if (!config.rotation.enabled) return null

  // Use calibrated threshold (auto-computed from user's own session history)
  // Falls back to conservative 10x / 30 turns if not enough data
  const cal = loadCalibration()

  if (turns.length < cal.minTurns) return null

  // Calculate waste factor first, then check if we should re-block
  const turnTokens = turns.map((t) =>
    t.usage.input_tokens + t.usage.output_tokens +
    t.usage.cache_creation_input_tokens + t.usage.cache_read_input_tokens
  )
  const baseline = turnTokens.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(5, turnTokens.length)
  const current = turnTokens.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, turnTokens.length)
  const wasteFactor = baseline > 0 ? Math.round(current / baseline) : 1

  // Absolute-tokens rule: sometimes the ratio is fine (e.g. 2x) but the
  // absolute tokens/turn is still wasteful. A session that started at 60k
  // and doubled to 120k has only 2x waste, but each turn still costs 120k.
  // If an absolute ceiling is configured, cross it and block regardless
  // of the ratio. Turbo mode implies an absolute ceiling at 150k.
  const absoluteCeiling = config.rotation.absoluteBlockTokens
    ?? (config.turbo ? 150_000 : null)
  const absoluteExceeded = absoluteCeiling !== null && current >= absoluteCeiling

  if (wasteFactor < cal.wasteThreshold && !absoluteExceeded) return null

  // Re-block logic: track the waste level when last blocked.
  // If waste dropped significantly (compaction happened), reset and block again.
  // Otherwise, only re-block at every 2x increase to avoid spamming.
  const blockedAt = readJsonFile<Record<string, number>>(BLOCK_NUDGE_FILE, {})
  const key = `post-${sessionId}`
  const lastBlockedWaste = blockedAt[key] || 0
  if (lastBlockedWaste > 0) {
    // Waste dropped by more than half → compaction happened, reset and re-block
    if (wasteFactor < lastBlockedWaste / 2) {
      // Reset — will proceed to block below
    } else if (wasteFactor < lastBlockedWaste + 2) {
      return null
    }
  }

  // Mark as blocked at this waste level
  blockedAt[key] = wasteFactor
  try { writeJsonFileAtomic(BLOCK_NUDGE_FILE, blockedAt) } catch {}

  // Save session state — each save creates a separate file now (no overwrite risk)
  const transcriptPath = findTranscriptSync(sessionId)
  if (transcriptPath) {
    const stateData = extractSessionStateFromTranscript(sessionId, transcriptPath)
    if (stateData) saveSessionState(stateData)
  }

  logActivity({
    type: 'context_warning',
    session: sessionId.slice(0, 8),
    message: `BLOCKED tool result — ${wasteFactor}x waste (${Math.round(current / 1000)}k/turn vs ${Math.round(baseline / 1000)}k baseline)`,
  }).catch(() => {})

  // Keep this message short. Every character sits in Claude's context for the
  // rest of the session as cache reads. Ask for the 4 most load-bearing
  // sections (TASK, IN_PROGRESS, FAILED_APPROACHES, BLOCKERS); the parser in
  // session-state.ts only needs 2+ headers to recognize structure, and Claude
  // can add more sections from memory without being prompted.
  return {
    decision: 'block',
    reason:
      `clauditor: ${wasteFactor}x waste (${Math.round(baseline / 1000)}k → ${Math.round(current / 1000)}k tokens/turn). Progress saved.\n` +
      `Before stopping:\n` +
      `1. Tell the user to run \`claude\` for a fresh session, then say "continue where I left off".\n` +
      `2. Write a handoff with these sections (bulleted): TASK, IN_PROGRESS, FAILED_APPROACHES, BLOCKERS. Add DECISIONS/USER_PREFERENCES/GOTCHAS if relevant.\n` +
      `3. End your response with the marker [clauditor-rotation].`,
  }
}

const BLOCK_NUDGE_FILE = resolve(homedir(), '.clauditor', 'prompt-block-nudge.json')

// ─── Gotcha Check ──────────────────────────────────────────────
// Rate limit: max 1 gotcha check per file per session.
// Persisted to disk because each hook invocation is a separate process.
const GOTCHA_CHECKED_FILE = resolve(homedir(), '.clauditor', 'gotcha-checked.json')

function hasCheckedGotcha(sessionId: string, filePath: string): boolean {
  const data = readJsonFile<Record<string, string[]>>(GOTCHA_CHECKED_FILE, {})
  return (data[sessionId] || []).includes(filePath)
}

function markGotchaChecked(sessionId: string, filePath: string): void {
  const data = readJsonFile<Record<string, string[]>>(GOTCHA_CHECKED_FILE, {})
  if (!data[sessionId]) data[sessionId] = []
  if (!data[sessionId].includes(filePath)) {
    data[sessionId].push(filePath)
  }
  try { writeJsonFileAtomic(GOTCHA_CHECKED_FILE, data) } catch {}
}

/**
 * Fire-and-forget gotcha query for a file.
 * Queries GET /api/v1/gotchas?project_hash=X&filepath=Y
 * Returns additionalContext string if gotchas found, null otherwise.
 */
async function queryGotchasForFile(cwd: string, filePath: string): Promise<string | null> {
  try {
    const { resolveHubContext } = await import('../hub/client.js')
    const hub = resolveHubContext(cwd)
    if (!hub) return null

    const url = `${hub.config.url}/api/v1/gotchas?project_hash=${encodeURIComponent(hub.projectHash)}&filepath=${encodeURIComponent(filePath)}`
    const res = await fetch(url, {
      headers: { 'X-Clauditor-Key': hub.config.apiKey, 'Content-Type': 'application/json' },
    })
    if (!res.ok) return null

    const data = (await res.json()) as { gotchas?: Array<{ title: string; description: string; solution?: string }> }
    if (!data.gotchas || data.gotchas.length === 0) return null

    const lines = data.gotchas.map((g) =>
      `- **${g.title}**: ${g.description}${g.solution ? ` → ${g.solution}` : ''}`
    )
    return (
      `[clauditor hub — gotchas for \`${filePath.split('/').pop()}\`]:\n` + lines.join('\n')
    )
  } catch {
    return null
  }
}

const ERROR_PATTERNS = [
  /error:/i,
  /Error:/,
  /ENOENT/,
  /EACCES/,
  /EPERM/,
  /command not found/,
  /No such file or directory/,
  /Permission denied/,
  /Cannot find module/,
  /FATAL/,
  /panic:/,
  /Traceback \(most recent/,
  /SyntaxError/,
  /TypeError/,
  /ReferenceError/,
  /ModuleNotFoundError/,
  /exit code [1-9]/i,
  /npm ERR!/,
  /failed with exit code/i,
]

/**
 * Detect bash errors and inject guidance before Claude retries blindly.
 *
 * Fires on every error — hooks are separate processes so we can't dedup
 * in memory. This is intentional: consistent "read the error" guidance
 * on every failure is how you'd coach a developer. It's not spam.
 */
function detectBashError(sessionId: string, output: string): string | null {
  if (!output || output.length < 20) return null

  const hasError = ERROR_PATTERNS.some((p) => p.test(output))
  if (!hasError) return null

  return `[clauditor]: Command failed. Read the error, then change the approach (not just retry).`
}

/**
 * Track file edit counts per session. When the same file is edited 5+ times,
 * it's likely Claude is thrashing — iterating on code instead of stepping
 * back to understand the design problem.
 *
 * Persisted to disk because each hook invocation is a separate process.
 */
const EDIT_COUNTS_FILE = resolve(homedir(), '.clauditor', 'edit-counts.json')

// Two-tier warning: soft nudge first, harder stop second. Catching thrash
// early saves the later Read-Edit-verify cycles, which are the most
// expensive because they happen after the file has already grown in context.
// Turbo mode pulls both tiers one step earlier.
function trackFileEdits(sessionId: string, filePath: string): string | null {
  const turbo = isTurbo()
  const softAt = turbo ? TURBO_THRESHOLDS.editThrashSoft : 3
  const hardAt = turbo ? TURBO_THRESHOLDS.editThrashHard : 5

  const allCounts = readJsonFile<Record<string, Record<string, number>>>(EDIT_COUNTS_FILE, {})
  if (!allCounts[sessionId]) allCounts[sessionId] = {}
  const count = (allCounts[sessionId][filePath] || 0) + 1
  allCounts[sessionId][filePath] = count
  try { writeJsonFileAtomic(EDIT_COUNTS_FILE, allCounts) } catch {}

  const fileName = filePath.split(/[/\\]/).pop() || filePath

  if (count === softAt) {
    logActivity({
      type: 'cache_warning',
      session: sessionId.slice(0, 8),
      message: `Edit thrash soft warning: ${fileName} edited ${count} times`,
    }).catch(() => {})
    return `[clauditor]: ${count} edits to ${fileName}. If iterating, consider stepping back to confirm the approach is right.`
  }

  if (count === hardAt) {
    logActivity({
      type: 'cache_warning',
      session: sessionId.slice(0, 8),
      message: `Edit thrashing detected: ${fileName} edited ${count} times`,
    }).catch(() => {})
    return (
      `[clauditor]: ${count} edits to ${fileName}. Stop and check with the user that the approach is right before continuing. ` +
      `Implementation iteration often masks an architectural problem.`
    )
  }

  return null
}

function formatSize(chars: number): string {
  if (chars < 1000) return `${chars} chars`
  return `${(chars / 1000).toFixed(1)}k chars`
}

// Run if invoked directly
handlePostToolUseHook().catch((err) => {
  process.stderr.write(`clauditor post-tool-use hook error: ${err}\n`)
  process.stdout.write('{}')
  process.exit(0)
})
