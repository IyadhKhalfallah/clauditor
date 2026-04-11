import { readFileSync } from 'node:fs'
import type { StopHookInput, HookDecision, SessionRecord, AssistantRecord } from '../types.js'
import { createHash } from 'node:crypto'
import { logActivity } from '../features/activity-log.js'
import { savePostCompactSummary } from '../features/session-state.js'
import { readStdin, outputDecision } from './shared.js'

/**
 * Stop hook handler — detects compaction loops and blocks further execution.
 * Also captures Claude's handoff summary after a rotation block.
 *
 * This uses Claude Code's official Stop hook API. The hook receives session
 * context on stdin and outputs a decision to stdout.
 *
 * When a loop is detected (same tool calls repeated 3+ times), it blocks
 * the session to prevent token waste.
 */
export async function handleStopHook(): Promise<void> {
  let hookInput: StopHookInput
  try {
    const input = await readStdin()
    hookInput = JSON.parse(input) as StopHookInput
  } catch {
    outputDecision({})
    return
  }

  // If stop_hook_active is true, another stop hook is already running.
  // Do not block again to prevent infinite loops.
  if (hookInput.stop_hook_active) {
    outputDecision({})
    return
  }

  // Await all async hub pushes before outputDecision — process exits after stdout write
  await Promise.allSettled([
    captureRotationHandoff(hookInput),
    pushSubagentSignals(hookInput),
    reportKnowledgeOutcomes(hookInput),
  ])

  const decision = analyzeForLoop(hookInput)
  outputDecision(decision)
}

export function analyzeForLoop(input: StopHookInput): HookDecision {
  let records: SessionRecord[]
  try {
    const content = readFileSync(input.transcript_path, 'utf-8')
    records = content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(Boolean) as SessionRecord[]
  } catch {
    return {}
  }

  // Get the last N assistant records with tool calls
  const assistantRecords = records
    .filter((r): r is AssistantRecord => r.type === 'assistant')
    .slice(-6)

  if (assistantRecords.length < 3) return {}

  // Hash the tool calls from each turn
  const turnHashes = assistantRecords.map((record) => {
    const toolCalls = (record.message.content || [])
      .filter((block) => block.type === 'tool_use')
      .map((block) => `${block.name}:${hashValue(block.input)}`)
      .join('|')
    return toolCalls || ''
  })

  // Check for 3+ consecutive identical turn hashes
  let consecutiveCount = 1
  for (let i = turnHashes.length - 1; i > 0; i--) {
    if (turnHashes[i] && turnHashes[i] === turnHashes[i - 1]) {
      consecutiveCount++
    } else {
      break
    }
  }

  if (consecutiveCount >= 3) {
    // Identify what's looping
    const lastTools = assistantRecords[assistantRecords.length - 1].message.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => b.name)
      .join(', ')

    logActivity({
      type: 'loop_blocked',
      session: input.session_id.slice(0, 8),
      message: `Blocked loop — ${lastTools || 'tool'} call(s) repeated ${consecutiveCount}x with identical output`,
    }).catch(() => {})

    return {
      decision: 'block',
      reason:
        `Loop detected: same ${lastTools || 'tool'} call(s) failed ${consecutiveCount} times ` +
        'with identical output. Stopping to prevent token waste. ' +
        'Please review the error and try a different approach.',
    }
  }

  return {}
}

/**
 * After a rotation block (PostToolUse exit code 2), Claude writes a handoff
 * summary in its response. The Stop hook fires after that response, and
 * `last_assistant_message` contains Claude's summary. If it looks like a
 * rotation handoff, save it as a rich per-session file — replacing the
 * sparse mechanical extraction that was saved during the block.
 */
async function captureRotationHandoff(input: StopHookInput): Promise<void> {
  const msg = input.last_assistant_message
  if (!msg || msg.length < 100) return

  // Detect if this is a rotation handoff summary.
  // The block message tells Claude to include [clauditor-rotation] marker.
  // Also check for strong rotation-specific AND pairs as fallback.
  const isRotationHandoff =
    msg.includes('[clauditor-rotation]') ||
    (msg.includes('burning') && msg.includes('quota')) ||
    (msg.includes('progress') && msg.includes('saved') && msg.includes('session')) ||
    (msg.includes('fresh session') && msg.includes('tokens/turn'))

  if (!isRotationHandoff) return

  const cwd = extractCwd(input.transcript_path)

  try {
    await savePostCompactSummary(msg, cwd, input.transcript_path || null)

    logActivity({
      type: 'context_warning',
      session: input.session_id.slice(0, 8),
      message: `Stop hook: captured Claude's rotation handoff summary (${msg.length} chars)`,
    }).catch(() => {})
  } catch (err) {
    process.stderr.write(`clauditor: failed to save rotation handoff: ${err}\n`)
  }

  // Push structured learnings to hub (awaited so it completes before process exits)
  try {
    const { resolveHubContext } = await import('../hub/client.js')
    const { scrubSecrets } = await import('../features/secret-scrubber.js')
    const { parseStructuredHandoff } = await import('../features/session-state.js')
    const hub = resolveHubContext(cwd || undefined)
    if (!hub) return

    const parsed = parseStructuredHandoff(msg)

    if (parsed.isStructured) {
      const learnings: Array<{ type: string; content: string; tags?: string[] }> = []

      for (const item of parsed.failedApproaches) {
        learnings.push({ type: 'failed_approach', content: scrubSecrets(item).scrubbed })
      }
      for (const item of parsed.dependencies) {
        learnings.push({ type: 'dependency', content: scrubSecrets(item).scrubbed })
      }
      for (const item of parsed.decisions) {
        learnings.push({ type: 'decision', content: scrubSecrets(item).scrubbed })
      }
      for (const item of parsed.whatSurprisedMe) {
        learnings.push({ type: 'surprise', content: scrubSecrets(item).scrubbed })
      }
      for (const item of parsed.gotchas) {
        learnings.push({ type: 'gotcha', content: scrubSecrets(item).scrubbed })
      }

      if (learnings.length > 0) {
        const { queueAndSend } = await import('../hub/push-queue.js')
        await queueAndSend(
          `${hub.config.url}/api/v1/handoff/learn`,
          { 'X-Clauditor-Key': hub.config.apiKey, 'Content-Type': 'application/json' },
          {
            project_hash: hub.projectHash,
            developer_hash: hub.config.developerHash,
            project_name: hub.remoteUrl,
            learnings,
          }
        )
      }
    }
  } catch {}
}

/**
 * Report knowledge outcomes — did the injected brief help?
 *
 * Simple heuristic: if the session didn't hit a loop (healthy),
 * all injected entries get a positive signal.
 */
async function reportKnowledgeOutcomes(input: StopHookInput): Promise<void> {
  if (input.stop_hook_active) return

  const cwd = extractCwd(input.transcript_path)
  if (!cwd) return

  try {
    const { reportOutcomes } = await import('../features/outcome-tracker.js')
    const reported = await reportOutcomes(input.session_id, cwd, true)
    if (reported > 0) {
      logActivity({
        type: 'notification',
        session: input.session_id.slice(0, 8),
        message: `Reported ${reported} positive outcomes for injected knowledge`,
      }).catch(() => {})
    }
  } catch (err) {
    process.stderr.write(`clauditor: outcome report failed: ${err instanceof Error ? err.message : err}\n`)
  }
}

/**
 * Push subagent metadata from the current session to the hub.
 * Reads .meta.json files for the session's subagents and sends
 * descriptions + categories. Fire-and-forget.
 */
async function pushSubagentSignals(input: StopHookInput): Promise<void> {
  const cwd = extractCwd(input.transcript_path)
  if (!cwd) return

  try {
    const { resolveHubContext } = await import('../hub/client.js')
    const hub = resolveHubContext(cwd)
    if (!hub) return

    const { scanSessionSubagents } = await import('../features/subagent-intel.js')
    const signals = scanSessionSubagents(cwd, input.session_id)
    if (signals.length === 0) return

    const { queueAndSend } = await import('../hub/push-queue.js')
    await queueAndSend(
      `${hub.config.url}/api/v1/subagents/sync`,
      { 'X-Clauditor-Key': hub.config.apiKey, 'Content-Type': 'application/json' },
      {
        project_hash: hub.projectHash,
        developer_hash: hub.config.developerHash,
        project_name: hub.remoteUrl,
        signals: signals.map(s => ({
          session_id: s.sessionId,
          agent_id: s.agentId,
          agent_type: s.agentType,
          description: s.description,
          category: s.category,
          files_touched: s.filesTouched,
          turn_count: s.turnCount,
        })),
      }
    )
  } catch (err) {
    process.stderr.write(`clauditor: subagent push failed: ${err instanceof Error ? err.message : err}\n`)
  }
}

/** Extract cwd from the last user record in the transcript. */
function extractCwd(transcriptPath: string): string | null {
  try {
    const content = readFileSync(transcriptPath, 'utf-8')
    const lines = content.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const r = JSON.parse(lines[i])
        if (r.type === 'user' && r.cwd) return r.cwd
      } catch {}
    }
  } catch {}
  return null
}

function hashValue(value: unknown): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return createHash('sha256').update(str).digest('hex').slice(0, 16)
}

// Run if invoked directly
handleStopHook().catch((err) => {
  process.stderr.write(`clauditor stop hook error: ${err}\n`)
  // Output empty decision on error to avoid breaking Claude Code
  process.stdout.write('{}')
  process.exit(0)
})
