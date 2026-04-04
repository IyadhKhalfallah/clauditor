import { logActivity } from '../features/activity-log.js'
import { saveSessionState, extractSessionStateFromTranscript } from '../features/session-state.js'
import { readStdin, outputDecision, findTranscriptPathSync } from './shared.js'

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

handlePreCompactHook().catch((err) => {
  process.stderr.write(`clauditor pre-compact hook error: ${err}\n`)
  process.stdout.write('{}')
  process.exit(0)
})
