import { logActivity } from '../features/activity-log.js'
import { saveSessionState, extractSessionStateFromTranscript } from '../features/session-state.js'
import { readStdin, outputDecision, findTranscriptPathSync } from './shared.js'

/**
 * PreCompact hook: fires right before Claude Code compacts the context.
 *
 * Two jobs:
 * 1. Save mechanical session state as a fallback before compaction runs.
 *    If PostCompact fires we'll replace this with Claude's own summary;
 *    if it doesn't, we still have something.
 * 2. Nudge Claude to produce a tighter summary than its default. Old
 *    tool_results (Reads, Bash output) from the first half of the session
 *    are usually stale; telling Claude to collapse them to one-line
 *    entries reduces the size of the compact_summary without losing the
 *    load-bearing context.
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

  let turnCount = 0
  try {
    const sessionId = hookInput.session_id
    const transcriptPath = hookInput.transcript_path || findTranscriptPathSync(sessionId)
    if (!transcriptPath) {
      outputDecision({})
      return
    }

    const stateData = extractSessionStateFromTranscript(sessionId, transcriptPath)
    if (stateData) {
      turnCount = stateData.turns
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

  // Inject a compaction-shaping instruction. Compaction is one of the most
  // expensive single operations in a Claude Code session because the model
  // regenerates a long summary from the full history. Asking for a tight,
  // structured summary up front reduces the output tokens it produces and
  // the cache_creation tokens on the turn after compaction.
  const earlierHalf = turnCount > 0 ? Math.max(1, Math.floor(turnCount / 2)) : null
  const earlierHint = earlierHalf
    ? `Turns 1 through ${earlierHalf} are old; collapse their tool_results to one-line entries. `
    : `Older tool_results are likely stale; collapse them to one-line entries. `

  outputDecision({
    additionalContext:
      `[clauditor]: Compaction is about to run. Keep the summary tight: ` +
      earlierHint +
      `Preserve files modified, decisions made, and blockers; drop raw file contents and verbose logs.`,
  })
}

handlePreCompactHook().catch((err) => {
  process.stderr.write(`clauditor pre-compact hook error: ${err}\n`)
  process.stdout.write('{}')
  process.exit(0)
})
