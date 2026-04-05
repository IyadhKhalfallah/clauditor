import type { PreToolUseHookInput, HookDecision } from '../types.js'
import { readStdin, outputDecision } from './shared.js'
import { findKnownError } from '../features/error-index.js'

// Rate limit: only inject once per unique base command per session
const injectedCommands = new Set<string>()

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

  // Rate limit: one injection per unique command per session
  const key = `${input.session_id}:${command.split(/\s+/).slice(0, 2).join(' ')}`
  if (injectedCommands.has(key)) return {}

  const knownError = findKnownError(input.cwd, command)
  if (!knownError) return {}

  injectedCommands.add(key)

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
