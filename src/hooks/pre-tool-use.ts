import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { PreToolUseHookInput, HookDecision } from '../types.js'
import { readStdin, outputDecision } from './shared.js'
import { findKnownError } from '../features/error-index.js'
import { resolveHubContext } from '../hub/client.js'

// Rate limit: only inject once per unique base command per session.
// Persisted to disk because each hook invocation is a separate process.
const RATE_LIMIT_FILE = resolve(homedir(), '.clauditor', 'pretool-injected.json')

function readInjected(): Record<string, boolean> {
  try { return JSON.parse(readFileSync(RATE_LIMIT_FILE, 'utf-8')) } catch { return {} }
}

function markInjected(key: string): void {
  const data = readInjected()
  data[key] = true
  try {
    mkdirSync(resolve(homedir(), '.clauditor'), { recursive: true })
    writeFileSync(RATE_LIMIT_FILE, JSON.stringify(data))
  } catch {}
}

/**
 * PreToolUse hook handler — injects error prevention knowledge.
 *
 * Before Claude runs a Bash command, checks:
 * 1. Local error index for known failures (free, offline)
 * 2. Hub error index for team-wide knowledge (if configured)
 *
 * Non-blocking — Claude decides whether to use the injected context.
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
  if (input.cwd) {
    const key = `${input.session_id}:${command.split(/\s+/).slice(0, 2).join(' ')}`
    const injected = readInjected()
    if (!injected[key]) {
      const knownError = findKnownError(input.cwd, command)
      if (knownError) {
        markInjected(key)
        let context = `[clauditor]: \`${knownError.command.slice(0, 60)}\` has failed ${knownError.occurrences} times on this project.\n`
        context += `Last error: ${knownError.error.slice(0, 150)}`
        if (knownError.fix) {
          context += `\nKnown fix: \`${knownError.fix.slice(0, 100)}\``
        }
        parts.push(context)
      }
    }
  }

  // 2. Hub contextual query (team-wide structured entries, if configured)
  const hub = resolveHubContext(input.cwd || undefined)
  if (hub) {
    const hubKey = `hub:${input.session_id}:${command.split(/\s+/).slice(0, 2).join(' ')}`
    const injected = readInjected()
    if (!injected[hubKey]) {
      try {
        const { queryKnowledge } = await import('../hub/client.js')
        const result = await queryKnowledge(hub.projectHash, 'command', command, hub.config)

        if (result.entries.length > 0) {
          markInjected(hubKey)
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
            `[clauditor hub — team knowledge for \`${command.split(/\s+/).slice(0, 2).join(' ')}\`]:\n` +
            lines.join('\n')
          )
        }
      } catch {
        // Hub unavailable — local check is enough
      }
    }
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
