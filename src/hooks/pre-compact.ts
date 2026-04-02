import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { HookDecision } from '../types.js'
import { logActivity } from '../features/activity-log.js'
import { saveSessionState, extractSessionStateFromTranscript, findTranscriptPathSync } from '../features/session-state.js'

/**
 * PreCompact hook — fires right before Claude Code compacts the context.
 *
 * This is the PERFECT moment to save session state:
 * - Compaction is about to erase older context
 * - We save to ~/.clauditor/last-session.md (not CLAUDE.md)
 * - The SessionStart hook injects this into the next session
 */
export async function handlePreCompactHook(): Promise<void> {
  const input = await readStdin()
  let hookInput: { session_id: string; transcript_path?: string }

  try {
    hookInput = JSON.parse(input)
  } catch {
    outputDecision({})
    return
  }

  try {
    const sessionId = hookInput.session_id
    const transcriptPath = hookInput.transcript_path || findTranscriptPathSync(sessionId)
    if (!transcriptPath) {
      outputDecision({})
      return
    }

    const stateData = extractSessionStateFromTranscript(sessionId, transcriptPath)
    if (stateData) {
      saveSessionState(stateData)
      logActivity({
        type: 'context_warning',
        session: sessionId.slice(0, 8),
        message: `PreCompact: saved ${stateData.turns}-turn session state before compaction`,
      }).catch(() => {})
    }
  } catch {
    // Non-critical
  }

  outputDecision({})
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

handlePreCompactHook().catch((err) => {
  process.stderr.write(`clauditor pre-compact hook error: ${err}\n`)
  process.stdout.write('{}')
  process.exit(0)
})
