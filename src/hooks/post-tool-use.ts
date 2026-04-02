import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { PostToolUseHookInput, HookDecision } from '../types.js'
import { compressBashOutput } from '../features/bash-filter.js'
import { parseJsonlFile, extractTurns } from '../daemon/parser.js'
import { detectCacheDegradation } from '../features/cache-health.js'
import { hasResumeBoundary } from '../features/resume-detector.js'
import { detectResumeAnomaly } from '../features/resume-detector.js'
import { estimateQuotaBurnRate } from '../features/quota-burn.js'

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
      }
    }
  }

  // 2. Check session health (rate-limited to avoid overhead on every call)
  const healthWarning = await checkSessionHealth(input.session_id)
  if (healthWarning) {
    parts.push(healthWarning)
  }

  if (parts.length === 0) return {}

  return { additionalContext: parts.join('\n\n') }
}

// Track when we last checked health per session to avoid checking on every tool call
const lastHealthCheck = new Map<string, number>()
const HEALTH_CHECK_INTERVAL_MS = 60_000 // check at most once per minute

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

    // Check cache health
    const cacheHealth = detectCacheDegradation(turns)
    if (cacheHealth.degradationDetected) {
      warnings.push(
        `[clauditor WARNING]: This session's cache is broken — responses will be significantly slower. ` +
        `Cache hit ratio is ${(cacheHealth.lastCacheRatio * 100).toFixed(0)}% (should be >70%). ` +
        `The full conversation is being re-read from scratch each turn instead of using cache. ` +
        `Recommend telling the user to run /clear and re-state what they're working on, or start a fresh session.`
      )
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
        `[clauditor WARNING]: Context window is ${pct}% full (${(contextSize / 1000).toFixed(0)}k / 200k tokens). ` +
        `Auto-compaction will happen soon — this will summarize and drop older context, ` +
        `which means you may lose track of earlier decisions, instructions, and file changes. ` +
        `Recommend telling the user to start a fresh session. Save any important context to CLAUDE.md first.`
      )
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
      }
      if (resumeAnomaly.cacheInvalidatedAfterResume) {
        warnings.push(
          `[clauditor WARNING]: Session resume has invalidated the prompt cache. ` +
          `Every turn is now reprocessing the full context from scratch instead of using cached tokens. ` +
          `This drains quota 10-20x faster than normal. Recommend telling the user to start a fresh session.`
        )
      }
    }

    // Check quota burn rate
    const burnRate = estimateQuotaBurnRate(turns)
    if (burnRate.burnRateStatus === 'critical') {
      warnings.push(
        `[clauditor WARNING]: Unusually high token consumption — ` +
        `${(burnRate.tokensPerMinute / 1000).toFixed(0)}k tokens/min, which is much higher than normal. ` +
        `This usually means cache is broken or there's a token generation bug. ` +
        `Recommend checking cache health and running /clear if cache ratio is low.`
      )
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
