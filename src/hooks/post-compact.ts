import { logActivity } from '../features/activity-log.js'
import { savePostCompactSummary, parseStructuredHandoff } from '../features/session-state.js'
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
 * Also pushes structured learnings to the hub (if any found in the summary).
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

  // Push to hub: structured learnings + summary as team memory
  await pushCompactToHub(summary, hookInput.cwd || null)

  outputDecision({})
}

/**
 * Push compact summary to hub:
 * 1. Structured learnings (FAILED_APPROACHES, etc.) → knowledge entries
 * 2. Full summary → team memory (searchable via RAG)
 */
async function pushCompactToHub(summary: string, cwd: string | null): Promise<void> {
    try {
      const { resolveHubContext } = await import('../hub/client.js')
      const { scrubSecrets } = await import('../features/secret-scrubber.js')
      const { queueAndSend } = await import('../hub/push-queue.js')
      const { createHash } = await import('node:crypto')
      const hub = resolveHubContext(cwd || undefined)
      if (!hub) return

      // 1. Push structured learnings if present
      const parsed = parseStructuredHandoff(summary)
      if (parsed.isStructured) {
        const learnings: Array<{ type: string; content: string }> = []
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

      // 2. Push full summary as a team memory (searchable via RAG)
      const scrubbed = scrubSecrets(summary).scrubbed
      const contentHash = createHash('sha256').update(scrubbed).digest('hex').slice(0, 16)
      const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
      await queueAndSend(
        `${hub.config.url}/api/v1/memory/sync`,
        { 'X-Clauditor-Key': hub.config.apiKey, 'Content-Type': 'application/json' },
        {
          project_hash: hub.projectHash,
          developer_hash: hub.config.developerHash,
          project_name: hub.remoteUrl,
          memories: [{
            name: `Session summary (${timestamp})`,
            description: 'Claude\'s own session summary captured at compaction',
            memory_type: 'session_summary',
            content: scrubbed,
            content_hash: contentHash,
            source_file: `compact_${contentHash}`,
            scope: 'team',
          }],
        }
      )

      const { logActivity } = await import('../features/activity-log.js')
      logActivity({
        type: 'notification',
        session: 'compact',
        message: `Pushed session summary to hub (${scrubbed.length} chars)`,
      }).catch(() => {})
    } catch (err) {
      process.stderr.write(`clauditor: compact hub push failed: ${err instanceof Error ? err.message : err}\n`)
    }
}

// Run if invoked directly
handlePostCompactHook().catch((err) => {
  process.stderr.write(`clauditor post-compact hook error: ${err}\n`)
  process.stdout.write('{}')
  process.exit(0)
})
