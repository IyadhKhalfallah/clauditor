import { logActivity } from '../features/activity-log.js'
import { savePostCompactSummary } from '../features/session-state.js'
import { readStdin, outputDecision } from './shared.js'

/**
 * PostCompact hook handler.
 *
 * Fires AFTER Claude Code compacts the conversation. Receives `compact_summary`
 * — Claude's own LLM-generated summary of the session, created while it still
 * had full context. This is dramatically better than mechanical JSONL extraction
 * because the LLM knows the reasoning, blockers, and plan.
 *
 * Saves per-session to ~/.clauditor/sessions/<encoded-cwd>/<timestamp>.md
 */
export async function handlePostCompactHook(): Promise<void> {
  const input = await readStdin()
  let hookInput: {
    session_id: string
    cwd?: string
    hook_event_name: string
    trigger?: string
    compact_summary?: string
    transcript_path?: string
  }

  try {
    hookInput = JSON.parse(input)
  } catch {
    outputDecision({})
    return
  }

  const summary = hookInput.compact_summary
  if (!summary || summary.trim().length === 0) {
    outputDecision({})
    return
  }

  try {
    await savePostCompactSummary(summary, hookInput.cwd || null, hookInput.transcript_path || null)

    logActivity({
      type: 'context_warning',
      session: hookInput.session_id?.slice(0, 8) || 'unknown',
      message: `PostCompact: saved Claude's own summary (${summary.length} chars)`,
    }).catch(() => {})
  } catch {
    // Non-critical
  }

  outputDecision({})
}

// Run if invoked directly
handlePostCompactHook().catch((err) => {
  process.stderr.write(`clauditor post-compact hook error: ${err}\n`)
  process.stdout.write('{}')
  process.exit(0)
})
