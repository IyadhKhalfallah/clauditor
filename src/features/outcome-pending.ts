import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

/**
 * Outcome-pending state, shared between the PreToolUse and PostToolUse hooks.
 *
 * When PreToolUse injects a warning, it records the command here so
 * PostToolUse can check whether it succeeded or failed and adjust confidence.
 *
 * This lives in its own module (no top-level side effects) specifically so
 * that importing it does NOT pull in either hook handler's self-invoking
 * "run if invoked directly" code. Both hooks/pre-tool-use.ts and
 * hooks/post-tool-use.ts import from here directly — do not move these
 * functions back into either hook file, or re-export them from one hook
 * module into the other. Doing so previously caused PostToolUse to
 * transitively import (and thus execute) PreToolUseHook's handler, which
 * wrote a second JSON object to stdout on every PostToolUse call and broke
 * hook output parsing (see the module comment in hooks/pre-tool-use.ts and
 * hooks/post-tool-use.ts).
 */

function outcomeStateFile(): string {
  return resolve(homedir(), '.clauditor', 'pretool-outcome-pending.json')
}

export interface OutcomePending {
  command: string
  baseCommand: string
  timestamp: number
  hubEntryIds?: string[]
}

/** Write outcome-pending state so PostToolUse can track the result. */
export function setOutcomePending(pending: OutcomePending): void {
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
