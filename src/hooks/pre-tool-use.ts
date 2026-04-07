import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { PreToolUseHookInput, HookDecision } from '../types.js'
import { readStdin, outputDecision } from './shared.js'
import { findKnownError } from '../features/error-index.js'

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
  const input = await readStdin()
  const hookInput = JSON.parse(input) as PreToolUseHookInput

  const decision = await processPreToolUse(hookInput)
  outputDecision(decision)
}

async function processPreToolUse(input: PreToolUseHookInput): Promise<HookDecision> {
  // Only check Bash commands
  if (input.tool_name !== 'Bash') return {}

  const command = input.tool_input?.command as string
  if (!command) return {}

  const parts: string[] = []

  // 1. Local error index check (free, offline, instant)
  let injectedWarning = false
  const baseCommand = command.split(/\s+/).slice(0, 2).join(' ')

  if (input.cwd) {
    const key = `${input.session_id}:${baseCommand}`
    const injected = readInjected()
    if (!injected[key]) {
      const knownError = findKnownError(input.cwd, command)
      if (knownError) {
        markInjected(key)
        injectedWarning = true
        let context = `[clauditor]: \`${knownError.command.slice(0, 60)}\` has failed ${knownError.occurrences} times on this project.\n`
        context += `Last error: ${knownError.error.slice(0, 150)}`
        if (knownError.fix) {
          context += `\nKnown fix: \`${knownError.fix.slice(0, 100)}\``
        }
        parts.push(context)
      }
    }
  }

  // 2. Hub contextual query (team-wide knowledge, if configured)
  let hubEntryIds: string[] = []

  if (input.cwd) {
    const hubKey = `hub:${input.session_id}:${baseCommand}`
    const injected = readInjected()
    if (!injected[hubKey]) {
      try {
        const { resolveHubContext, queryKnowledge } = await import('../hub/client.js')
        const hub = resolveHubContext(input.cwd)
        if (hub) {
          const result = await queryKnowledge(hub.projectHash, 'command', command, hub.config)
          if (result.entries.length > 0) {
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
