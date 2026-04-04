import type { PreToolUseHookInput, HookDecision } from '../types.js'
import { readStdin, outputDecision } from './shared.js'

/**
 * PreToolUse hook handler — placeholder for future pre-execution checks.
 *
 * Currently passes through all tool calls. Can be extended to:
 * - Block known-dangerous commands
 * - Warn on commands that generate excessive output
 * - Rate-limit rapid tool calls
 */
export async function handlePreToolUseHook(): Promise<void> {
  const input = await readStdin()
  const hookInput = JSON.parse(input) as PreToolUseHookInput

  const decision = processPreToolUse(hookInput)
  outputDecision(decision)
}

function processPreToolUse(_input: PreToolUseHookInput): HookDecision {
  // Pass through — no blocking logic yet
  return {}
}

// Run if invoked directly
handlePreToolUseHook().catch((err) => {
  process.stderr.write(`clauditor pre-tool-use hook error: ${err}\n`)
  process.stdout.write('{}')
  process.exit(0)
})
