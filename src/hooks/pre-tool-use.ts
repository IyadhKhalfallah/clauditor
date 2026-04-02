import type { PreToolUseHookInput, HookDecision } from '../types.js'

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

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk) => (data += chunk))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

function outputDecision(decision: HookDecision): void {
  process.stdout.write(JSON.stringify(decision))
}

// Run if invoked directly
handlePreToolUseHook().catch((err) => {
  process.stderr.write(`clauditor pre-tool-use hook error: ${err}\n`)
  process.stdout.write('{}')
  process.exit(0)
})
