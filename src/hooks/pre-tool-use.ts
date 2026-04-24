import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { PreToolUseHookInput, HookDecision } from '../types.js'
import { readStdin, outputDecision } from './shared.js'
import { findKnownError, effectiveConfidence } from '../features/error-index.js'
import { fingerprintCall, checkAndRecord } from '../features/tool-call-dedup.js'
import { getCached, setCached } from '../hub/query-cache.js'

// Rate limit: only inject once per unique base command per session.
function rateLimitFile(): string {
  return resolve(homedir(), '.clauditor', 'pretool-injected.json')
}

// Outcome tracking: when PreToolUse injects a warning, record it so
// PostToolUse can check if the command succeeded/failed and adjust confidence.
function outcomeStateFile(): string {
  return resolve(homedir(), '.clauditor', 'pretool-outcome-pending.json')
}

export interface OutcomePending {
  command: string
  baseCommand: string
  timestamp: number
  hubEntryIds?: string[]
}

function readInjected(): Record<string, boolean> {
  try { return JSON.parse(readFileSync(rateLimitFile(), 'utf-8')) } catch { return {} }
}

function markInjected(key: string): void {
  const data = readInjected()
  data[key] = true
  try {
    mkdirSync(resolve(homedir(), '.clauditor'), { recursive: true })
    writeFileSync(rateLimitFile(), JSON.stringify(data))
  } catch {}
}

/** Write outcome-pending state so PostToolUse can track the result. */
function setOutcomePending(pending: OutcomePending): void {
  try {
    mkdirSync(resolve(homedir(), '.clauditor'), { recursive: true })
    writeFileSync(outcomeStateFile(), JSON.stringify(pending))
  } catch {}
}

export function readOutcomePending(): OutcomePending | null {
  try {
    const data = JSON.parse(readFileSync(outcomeStateFile(), 'utf-8'))
    // Must have required fields
    if (!data.command || !data.timestamp) return null
    // Expire after 5 minutes
    if (Date.now() - data.timestamp > 5 * 60 * 1000) return null
    return data
  } catch {
    return null
  }
}

export function clearOutcomePending(): void {
  try { writeFileSync(outcomeStateFile(), '{}') } catch {}
}

/**
 * PreToolUse hook handler — injects error prevention knowledge.
 *
 * Before Claude runs a Bash command, checks the error index for known failures.
 * If this command has failed before on this project, injects the known fix
 * as additional context. Non-blocking — Claude decides whether to use it.
 */
export async function handlePreToolUseHook(): Promise<void> {
  let hookInput: PreToolUseHookInput
  try {
    const input = await readStdin()
    hookInput = JSON.parse(input) as PreToolUseHookInput
  } catch {
    outputDecision({})
    return
  }

  const decision = await processPreToolUse(hookInput)
  outputDecision(decision)
}

async function processPreToolUse(input: PreToolUseHookInput): Promise<HookDecision> {
  const parts: string[] = []

  // 0. Within-session tool-call dedup. Fires for Read/Grep/Glob because
  // those are the tools most likely to be re-invoked with identical input
  // in a long session. For Read the fingerprint includes mtime, so a file
  // edited between calls is never treated as duplicate.
  if (input.tool_name === 'Read' || input.tool_name === 'Grep' || input.tool_name === 'Glob') {
    const fp = fingerprintCall(input.tool_name, (input.tool_input || {}) as Record<string, unknown>)
    if (fp) {
      const hint = checkAndRecord(input.session_id, input.tool_name, fp.fingerprint, fp.label)
      if (hint) parts.push(hint)
    }
  }

  // Only the rest of this hook runs on Bash
  if (input.tool_name !== 'Bash') {
    if (parts.length === 0) return {}
    return { additionalContext: parts.join('\n\n') }
  }

  const command = input.tool_input?.command as string
  if (!command) {
    if (parts.length === 0) return {}
    return { additionalContext: parts.join('\n\n') }
  }

  // 1. Local error index check (free, offline, instant)
  let injectedWarning = false
  const baseCommand = command.split(/\s+/).slice(0, 2).join(' ')
  let localHadConfirmedFix = false

  if (input.cwd) {
    const key = `${input.session_id}:${baseCommand}`
    const injected = readInjected()
    if (!injected[key]) {
      const knownError = findKnownError(input.cwd, command)
      if (knownError) {
        markInjected(key)
        injectedWarning = true
        // If the local entry is "confirmed" (effective confidence >= 0.7)
        // and has a fix, the hub is extremely unlikely to tell us anything
        // more useful. Skip the hub round-trip and its injection tokens.
        const eff = effectiveConfidence(knownError.confidence, knownError.lastSeen)
        if (eff >= 0.7 && knownError.fix) localHadConfirmedFix = true

        let context = `[clauditor]: \`${knownError.command.slice(0, 60)}\` has failed ${knownError.occurrences} times on this project.\n`
        context += `Last error: ${knownError.error.slice(0, 150)}`
        if (knownError.fix) {
          context += `\nKnown fix: \`${knownError.fix.slice(0, 100)}\``
        }
        parts.push(context)
      }
    }
  }

  // 2. Hub contextual query (team-wide knowledge, if configured).
  // Short-circuit when local already produced a confirmed fix.
  let hubEntryIds: string[] = []

  if (input.cwd && !localHadConfirmedFix) {
    const hubKey = `hub:${input.session_id}:${baseCommand}`
    const injected = readInjected()
    if (!injected[hubKey]) {
      try {
        const { resolveHubContext, queryKnowledge } = await import('../hub/client.js')
        const hub = resolveHubContext(input.cwd)
        if (hub) {
          // Consult the 10-minute local cache before hitting the hub.
          type QueryResult = Awaited<ReturnType<typeof queryKnowledge>>
          let result: QueryResult | null = getCached<QueryResult>(
            hub.projectHash, 'command', command
          )
          if (!result) {
            result = await queryKnowledge(hub.projectHash, 'command', command, hub.config)
            if (result) setCached(hub.projectHash, 'command', command, result)
          }
          if (result && result.entries.length > 0) {
            markInjected(hubKey)
            injectedWarning = true
            hubEntryIds = result.entries.map((e) => e.id)
            const lines = result.entries.map((e) => {
              const body = e.body as Record<string, string>
              if (e.entry_type === 'error_fix') {
                return `- **${e.title}**: ${body.error_pattern || ''}\n  Fix: ${body.fix || 'unknown'}`
              }
              if (e.entry_type === 'gotcha') {
                return `- **${e.title}**: ${body.description || ''}\n  Fix: ${body.solution || ''}`
              }
              return `- **${e.title}** (${e.entry_type})`
            })
            parts.push(
              `[clauditor hub — team knowledge for \`${baseCommand}\`]:\n` +
              lines.join('\n')
            )
          }
        }
      } catch {
        // Hub unavailable — local check is enough
      }
    }
  }

  // 3. Set outcome-pending state so PostToolUse can track the result
  if (injectedWarning) {
    setOutcomePending({
      command,
      baseCommand,
      timestamp: Date.now(),
      hubEntryIds: hubEntryIds.length > 0 ? hubEntryIds : undefined,
    })
  }

  if (parts.length === 0) return {}
  return { additionalContext: parts.join('\n\n') }
}

// Run if invoked directly
handlePreToolUseHook().catch((err) => {
  process.stderr.write(`clauditor pre-tool-use hook error: ${err}\n`)
  process.stdout.write('{}')
  process.exit(0)
})
