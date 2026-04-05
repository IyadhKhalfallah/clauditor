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
  const input = await readStdin()
  const hookInput = JSON.parse(input) as StopHookInput

  // If stop_hook_active is true, another stop hook is already running.
  // Do not block again to prevent infinite loops.
  if (hookInput.stop_hook_active) {
    outputDecision({})
    return
  }

  // Check if Claude just wrote a rotation handoff summary
  // (after PostToolUse blocked with exit code 2, Claude writes a summary)
  captureRotationHandoff(hookInput)

  const decision = analyzeForLoop(hookInput)
  outputDecision(decision)
}

function analyzeForLoop(input: StopHookInput): HookDecision {
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
function captureRotationHandoff(input: StopHookInput): void {
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

  // Extract cwd from transcript
  let cwd: string | null = null
  try {
    const content = readFileSync(input.transcript_path, 'utf-8')
    const lines = content.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const r = JSON.parse(lines[i])
        if (r.type === 'user' && r.cwd) {
          cwd = r.cwd
          break
        }
      } catch {}
    }
  } catch {}

  try {
    savePostCompactSummary(msg, cwd)

    logActivity({
      type: 'context_warning',
      session: input.session_id.slice(0, 8),
      message: `Stop hook: captured Claude's rotation handoff summary (${msg.length} chars)`,
    }).catch(() => {})
  } catch {}
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
