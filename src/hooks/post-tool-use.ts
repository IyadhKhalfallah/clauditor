import { readFile } from 'node:fs/promises'
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { PostToolUseHookInput, HookDecision, TurnMetrics } from '../types.js'
import { compressBashOutput } from '../features/bash-filter.js'
import { parseJsonlFile, extractTurns } from '../daemon/parser.js'
import { detectCacheDegradation } from '../features/cache-health.js'
import { hasResumeBoundary } from '../features/resume-detector.js'
import { detectResumeAnomaly } from '../features/resume-detector.js'
import { estimateQuotaBurnRate } from '../features/quota-burn.js'
import { logActivity } from '../features/activity-log.js'

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
  const input = await readStdin()
  const hookInput = JSON.parse(input) as PostToolUseHookInput

  const decision = await processToolResult(hookInput)
  outputDecision(decision)
}

async function processToolResult(input: PostToolUseHookInput): Promise<HookDecision> {
  const parts: string[] = []

  // 1. Compress bash output if applicable
  if (input.tool_name === 'Bash') {
    const toolResponse = input.tool_response || ''
    if (toolResponse.length >= 500) {
      const result = compressBashOutput(toolResponse)
      if (result.compressed) {
        const command =
          typeof input.tool_input?.command === 'string'
            ? input.tool_input.command.slice(0, 100)
            : 'command'
        parts.push(
          `[clauditor]: \`${command}\` output compressed from ` +
          `${formatSize(result.originalLength)} to ${formatSize(result.compressedLength)}.`
        )
        logActivity({
          type: 'bash_compressed',
          session: input.session_id.slice(0, 8),
          message: `Compressed bash output: ${formatSize(result.originalLength)} → ${formatSize(result.compressedLength)}`,
        }).catch(() => {})
      }
    }

    // 1b. Post-error guidance — catch failing commands at attempt 1
    // instead of waiting for the loop blocker at attempt 3.
    const errorGuidance = detectBashError(input.session_id, toolResponse)
    if (errorGuidance) {
      parts.push(errorGuidance)
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
    }
  }

  // 3. Suggest saving as a skill after a productive session
  const skillNudge = checkSkillNudge(input.session_id, input.tool_name)
  if (skillNudge) {
    parts.push(skillNudge)
  }

  // 4. Check session health (rate-limited to avoid overhead on every call)
  const healthWarning = await checkSessionHealth(input.session_id)
  if (healthWarning) {
    parts.push(healthWarning)
  }

  if (parts.length === 0) return {}

  return { additionalContext: parts.join('\n\n') }
}

// Track when we last checked health per session to avoid checking on every tool call
const lastHealthCheck = new Map<string, number>()
const HEALTH_CHECK_INTERVAL_MS = 30_000 // check every 30 seconds — fast enough to catch 20-min burnouts

async function checkSessionHealth(sessionId: string): Promise<string | null> {
  const now = Date.now()
  const lastCheck = lastHealthCheck.get(sessionId) ?? 0
  if (now - lastCheck < HEALTH_CHECK_INTERVAL_MS) return null
  lastHealthCheck.set(sessionId, now)

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
        `[clauditor WARNING]: This session's cache is broken — responses will be significantly slower. ` +
        `Cache hit ratio is ${(cacheHealth.lastCacheRatio * 100).toFixed(0)}% (should be >70%). ` +
        `The full conversation is being re-read from scratch each turn instead of using cache. ` +
        `Recommend telling the user to run /clear and re-state what they're working on, or start a fresh session.`
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

    // Check context window size — detect limit from actual usage
    const lastTurn = turns[turns.length - 1]
    const contextSize =
      lastTurn.usage.input_tokens +
      lastTurn.usage.cache_creation_input_tokens +
      lastTurn.usage.cache_read_input_tokens
    // If context > 200k, they're on extended context (Opus 1M)
    const contextLimit = contextSize > 200_000 ? 1_000_000 : 200_000
    const pct = Math.round((contextSize / contextLimit) * 100)

    if (pct >= 95) {
      warnings.push(
        `[clauditor WARNING — ACTION REQUIRED]: Context window is ${pct}% full (${(contextSize / 1000).toFixed(0)}k tokens). ` +
        `Auto-compaction is imminent and will erase older context from this session.\n\n` +
        `BEFORE continuing with the user's task, you MUST do the following:\n` +
        `1. Tell the user: "Context window is nearly full. Let me save our progress before compaction."\n` +
        `2. Write a summary of the current session to CLAUDE.md (or append to it) including:\n` +
        `   - Key architectural decisions made in this session\n` +
        `   - Files modified and why\n` +
        `   - Current task status and what remains to be done\n` +
        `   - Any conventions or patterns established\n` +
        `3. Then suggest the user start a fresh session with: "Start a new session — the context I just saved to CLAUDE.md will be loaded automatically."\n\n` +
        `This prevents "compaction amnesia" — the #1 complaint from Claude Code users.`
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
          `[clauditor WARNING]: Resume token explosion detected — ${(resumeAnomaly.outputTokenSpike / 1000).toFixed(0)}k output tokens ` +
          `generated in a single turn after session resume. This is a known bug that can drain the user's entire quota. ` +
          `Recommend telling the user to start a fresh session instead of resuming.`
        )
        logActivity({
          type: 'resume_warning',
          session: sessionId.slice(0, 8),
          message: `Resume token explosion — ${(resumeAnomaly.outputTokenSpike / 1000).toFixed(0)}k output tokens in one turn`,
        }).catch(() => {})
      }
      if (resumeAnomaly.cacheInvalidatedAfterResume) {
        warnings.push(
          `[clauditor WARNING]: Session resume has invalidated the prompt cache. ` +
          `Every turn is now reprocessing the full context from scratch instead of using cached tokens. ` +
          `This drains quota 10-20x faster than normal. Recommend telling the user to start a fresh session.`
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
          `[clauditor ALERT — TOKEN SPIKE]: The last turn consumed ${(lastTurnTokens / 1000).toFixed(0)}k tokens, ` +
          `which is ${(lastTurnTokens / avgTokens).toFixed(0)}x your session average of ${(avgTokens / 1000).toFixed(0)}k.\n\n` +
          `This is abnormal and will drain the user's quota rapidly. TELL THE USER IMMEDIATELY:\n` +
          `"Your last turn used ${(lastTurnTokens / 1000).toFixed(0)}k tokens — much more than usual. ` +
          `This could drain your session limit quickly. Want me to investigate why, or should we start a fresh session?"\n\n` +
          `Possible causes: cache invalidation after resume, large file accidentally included in context, ` +
          `or a known Claude Code bug. Check if cache_creation_input_tokens is unusually high.`
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
        `[clauditor WARNING]: Unusually high token consumption — ` +
        `${(burnRate.tokensPerMinute / 1000).toFixed(0)}k tokens/min, which is much higher than normal. ` +
        `This usually means cache is broken or there's a token generation bug. ` +
        `Recommend checking cache health and running /clear if cache ratio is low.`
      )
    }

    // SESSION ROTATION — the most impactful feature.
    // When tokens per turn are consistently high, the session is too big.
    // A fresh session would use 10x less quota for the same work.
    // This isn't a warning — Claude acts: saves context and tells user to start fresh.
    const rotationPrompt = checkSessionRotation(sessionId, turns)
    if (rotationPrompt) {
      // This takes priority over other warnings — prepend it
      warnings.unshift(rotationPrompt)
    }

    return warnings.length > 0 ? warnings.join('\n\n') : null
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
  let state: Record<string, { count: number; tools: string[]; nudged: boolean }> = {}
  try {
    state = JSON.parse(readFileSync(NUDGE_FILE, 'utf-8'))
  } catch {
    // File doesn't exist yet
  }

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
    try { writeFileSync(NUDGE_FILE, JSON.stringify(state)); } catch {}
    return null
  }

  // Check if session is productive enough:
  // 20+ tool calls AND at least 3 different tools (not just Read/Read/Read)
  if (session.count >= NUDGE_THRESHOLD && session.tools.length >= 3) {
    session.nudged = true
    try {
      mkdirSync(resolve(homedir(), '.clauditor'), { recursive: true })
      writeFileSync(NUDGE_FILE, JSON.stringify(state))
    } catch {}

    return (
      `[clauditor]: This has been a productive session (${session.count}+ actions across ${session.tools.length} tools). ` +
      `If the workflow you just completed is something you'd want to repeat, ` +
      `mention to the user: "Want me to save this workflow as a reusable skill? Just type /save-skill."\n` +
      `Only mention this once. If the user isn't interested, continue normally.`
    )
  }

  try {
    mkdirSync(resolve(homedir(), '.clauditor'), { recursive: true })
    writeFileSync(NUDGE_FILE, JSON.stringify(state))
  } catch {}
  return null
}

/**
 * Session rotation — the core value of clauditor.
 *
 * Data shows: a 454-turn session averages 219k tokens/turn = 99M total.
 * Five 90-turn sessions doing the same work would use ~20M total.
 * That's 5x less quota for identical output.
 *
 * When avg tokens/turn exceeds the threshold for enough turns,
 * Claude saves context to CLAUDE.md and tells user to start fresh.
 * Not a suggestion — an action.
 */
const ROTATION_TOKENS_THRESHOLD = 100_000  // avg tokens/turn to trigger
const ROTATION_MIN_TURNS = 30             // don't trigger on short sessions
const ROTATION_NUDGE_FILE = resolve(homedir(), '.clauditor', 'rotation-nudge.json')

function checkSessionRotation(sessionId: string, turns: TurnMetrics[]): string | null {
  if (turns.length < ROTATION_MIN_TURNS) return null

  // Check if already nudged this session
  let nudged: Record<string, boolean> = {}
  try {
    nudged = JSON.parse(readFileSync(ROTATION_NUDGE_FILE, 'utf-8'))
  } catch {}
  if (nudged[sessionId]) return null

  // Calculate average tokens per turn over last 10 turns
  const recentTurns = turns.slice(-10)
  const avgTokens = recentTurns.reduce((sum, t) => {
    return sum + t.usage.input_tokens + t.usage.output_tokens +
      t.usage.cache_creation_input_tokens + t.usage.cache_read_input_tokens
  }, 0) / recentTurns.length

  if (avgTokens < ROTATION_TOKENS_THRESHOLD) return null

  // Mark as nudged
  nudged[sessionId] = true
  try {
    mkdirSync(resolve(homedir(), '.clauditor'), { recursive: true })
    writeFileSync(ROTATION_NUDGE_FILE, JSON.stringify(nudged))
  } catch {}

  const freshEstimate = Math.round(avgTokens / 10 / 1000)
  const currentK = Math.round(avgTokens / 1000)
  const ratio = Math.round(avgTokens / (freshEstimate * 1000))

  // Write session state to CLAUDE.md DIRECTLY — don't rely on Claude to do it
  writeSessionState(sessionId, turns, currentK, ratio)

  logActivity({
    type: 'context_warning',
    session: sessionId.slice(0, 8),
    message: `Session rotation triggered — ${currentK}k tokens/turn avg, saved state to CLAUDE.md`,
  }).catch(() => {})

  return (
    `[clauditor — SESSION ROTATION]: This session is using ${currentK}k tokens per turn. ` +
    `A fresh session would use ~${freshEstimate}k per turn — ${ratio}x less quota.\n\n` +
    `clauditor has already saved session state to CLAUDE.md.\n\n` +
    `Tell the user: "This session has grown large (${turns.length} turns, ${currentK}k tokens/turn). ` +
    `I've saved our progress to CLAUDE.md. Starting a fresh session will use ${ratio}x less of your quota ` +
    `for the same work. Run \`claude\` to start fresh — I'll pick up exactly where we left off."`
  )
}

/**
 * Write session state to CLAUDE.md directly from the hook.
 * This actually executes instead of relying on Claude to follow instructions.
 */
function writeSessionState(sessionId: string, turns: TurnMetrics[], tokensPerTurnK: number, ratio: number): void {
  try {
    // Find the cwd from the transcript
    const transcriptPath = findTranscriptPathSync(sessionId)
    if (!transcriptPath) return

    const content = readFileSync(transcriptPath, 'utf-8')
    const lines = content.split('\n')

    // Extract cwd from first user record
    let cwd: string | null = null
    let gitBranch: string | null = null
    for (const line of lines) {
      try {
        const r = JSON.parse(line)
        if (r.type === 'user' && r.cwd) {
          cwd = r.cwd
          gitBranch = r.gitBranch || null
          break
        }
      } catch {}
    }
    if (!cwd) return

    const claudeMdPath = resolve(cwd, 'CLAUDE.md')

    // Extract files modified (from Edit/Write tool calls in the transcript)
    const filesModified = new Set<string>()
    for (const line of lines) {
      try {
        const r = JSON.parse(line)
        if (r.type === 'assistant' && r.message?.content) {
          for (const block of r.message.content) {
            if (block.type === 'tool_use' && (block.name === 'Edit' || block.name === 'Write')) {
              const fp = block.input?.file_path
              if (fp) filesModified.add(fp.split('/').pop() || fp)
            }
          }
        }
      } catch {}
    }

    const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const filesList = filesModified.size > 0
      ? Array.from(filesModified).slice(0, 15).join(', ')
      : 'none tracked'

    const stateBlock = [
      '',
      '## Session State (auto-saved by clauditor)',
      `- **Saved at:** ${now}`,
      `- **Branch:** ${gitBranch || 'unknown'}`,
      `- **Session size:** ${turns.length} turns, ${tokensPerTurnK}k tokens/turn`,
      `- **Reason:** Session rotation — a fresh session uses ${ratio}x less quota`,
      `- **Files modified:** ${filesList}`,
      `- **Action:** Start a fresh session with \`claude\` — this context will load automatically`,
      '',
    ].join('\n')

    // Read existing CLAUDE.md and check if we already appended
    let existing = ''
    try {
      existing = readFileSync(claudeMdPath, 'utf-8')
    } catch {}

    if (existing.includes('Session State (auto-saved by clauditor)')) {
      // Replace existing session state block
      existing = existing.replace(
        /\n## Session State \(auto-saved by clauditor\)[\s\S]*?(?=\n## |\n$|$)/,
        stateBlock
      )
      writeFileSync(claudeMdPath, existing)
    } else {
      // Append
      appendFileSync(claudeMdPath, stateBlock)
    }
  } catch {
    // Non-critical — if we can't write, the additionalContext message is still sent
  }
}

/**
 * Synchronous version of findTranscriptPath for use in the rotation check.
 */
function findTranscriptPathSync(sessionId: string): string | null {
  const projectsDir = resolve(homedir(), '.claude/projects')
  try {
    const dirs = readdirSync(projectsDir, { withFileTypes: true })
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue
      const candidate = resolve(projectsDir, dir.name, `${sessionId}.jsonl`)
      try {
        readFileSync(candidate, { flag: 'r' })
        return candidate
      } catch {}
    }
  } catch {}
  return null
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

  return (
    `[clauditor]: The previous command produced an error. Before retrying:\n` +
    `1. Read the error output carefully — the fix is usually in the message\n` +
    `2. If you've already tried this approach and it failed, try a different one\n` +
    `3. If you're unsure, explain the error to the user and ask for guidance\n` +
    `Do not retry the same command without changing something.`
  )
}

/**
 * Track file edit counts per session. When the same file is edited 5+ times,
 * it's likely Claude is thrashing — iterating on code instead of stepping
 * back to understand the design problem.
 */
const fileEditCounts = new Map<string, Map<string, number>>()
const EDIT_THRASH_THRESHOLD = 5

function trackFileEdits(sessionId: string, filePath: string): string | null {
  if (!fileEditCounts.has(sessionId)) {
    fileEditCounts.set(sessionId, new Map())
  }
  const counts = fileEditCounts.get(sessionId)!
  const count = (counts.get(filePath) || 0) + 1
  counts.set(filePath, count)

  if (count === EDIT_THRASH_THRESHOLD) {
    const fileName = filePath.split(/[/\\]/).pop() || filePath
    logActivity({
      type: 'cache_warning',
      session: sessionId.slice(0, 8),
      message: `Edit thrashing detected: ${fileName} edited ${count} times`,
    }).catch(() => {})

    return (
      `[clauditor WARNING]: You've edited ${fileName} ${count} times this session. ` +
      `This usually means you're iterating on implementation when the problem is architectural.\n\n` +
      `STOP editing and do this instead:\n` +
      `1. Explain to the user what you're trying to achieve with this file\n` +
      `2. Ask if the current approach is correct before making more changes\n` +
      `3. If the user confirms, continue. If not, step back and redesign.\n\n` +
      `Repeated edits to the same file waste tokens and frustrate users.`
    )
  }

  return null
}

function formatSize(chars: number): string {
  if (chars < 1000) return `${chars} chars`
  return `${(chars / 1000).toFixed(1)}k chars`
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk) => (data += chunk))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

function outputDecision(decision: HookDecision): void {
  process.stdout.write(JSON.stringify(decision))
}

// Run if invoked directly
handlePostToolUseHook().catch((err) => {
  process.stderr.write(`clauditor post-tool-use hook error: ${err}\n`)
  process.stdout.write('{}')
  process.exit(0)
})
