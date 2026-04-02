import { readFileSync } from 'node:fs'
import type { StopHookInput, HookDecision, SessionRecord, AssistantRecord } from '../types.js'
import { createHash } from 'node:crypto'
import { logActivity } from '../features/activity-log.js'

/**
 * Stop hook handler — detects compaction loops and blocks further execution.
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

function hashValue(value: unknown): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return createHash('sha256').update(str).digest('hex').slice(0, 16)
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
handleStopHook().catch((err) => {
  process.stderr.write(`clauditor stop hook error: ${err}\n`)
  // Output empty decision on error to avoid breaking Claude Code
  process.stdout.write('{}')
  process.exit(0)
})
