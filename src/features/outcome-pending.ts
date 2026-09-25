import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

// Outcome tracking: when PreToolUse injects a warning, record it so
// PostToolUse can check if the command succeeded/failed and adjust confidence.
//
// Lives outside hooks/ on purpose: hook modules run their handler on import,
// so post-tool-use importing pre-tool-use made both handlers race for stdin.
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
