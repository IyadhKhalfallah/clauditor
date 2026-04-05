import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { PreToolUseHookInput, HookDecision } from '../types.js'
import { readStdin, outputDecision } from './shared.js'
import { findKnownError } from '../features/error-index.js'

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
 * Before Claude runs a Bash command, checks the error index for known failures.
 * If this command has failed before on this project, injects the known fix
 * as additional context. Non-blocking — Claude decides whether to use it.
 */
export async function handlePreToolUseHook(): Promise<void> {
  const input = await readStdin()
  const hookInput = JSON.parse(input) as PreToolUseHookInput

  const decision = processPreToolUse(hookInput)
  outputDecision(decision)
}

function processPreToolUse(input: PreToolUseHookInput): HookDecision {
  // Only check Bash commands
  if (input.tool_name !== 'Bash') return {}

  const command = input.tool_input?.command as string
  if (!command || !input.cwd) return {}

  // Rate limit: one injection per unique command per session (persisted to disk)
  const key = `${input.session_id}:${command.split(/\s+/).slice(0, 2).join(' ')}`
  const injected = readInjected()
  if (injected[key]) return {}

  const knownError = findKnownError(input.cwd, command)
  if (!knownError) return {}

  markInjected(key)

  let context = `[clauditor]: \`${knownError.command.slice(0, 60)}\` has failed ${knownError.occurrences} times on this project.\n`
  context += `Last error: ${knownError.error.slice(0, 150)}`

  if (knownError.fix) {
    context += `\nKnown fix: \`${knownError.fix.slice(0, 100)}\``
  }

  return { additionalContext: context }
}

// Run if invoked directly
handlePreToolUseHook().catch((err) => {
  process.stderr.write(`clauditor pre-tool-use hook error: ${err}\n`)
  process.stdout.write('{}')
  process.exit(0)
})
