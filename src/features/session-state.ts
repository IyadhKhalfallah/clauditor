import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const CLAUDITOR_DIR = resolve(homedir(), '.clauditor')
const LAST_SESSION_FILE = resolve(CLAUDITOR_DIR, 'last-session.md')

export interface SessionStateData {
  savedAt: string
  branch: string | null
  turns: number
  tokensPerTurn: number
  wasteFactor: number
  filesModified: string[]
  cwd: string | null
}

/**
 * Save session state to ~/.clauditor/last-session.md
 * NOT to CLAUDE.md — avoids git noise, extra tokens per turn, and project file modification.
 * The SessionStart hook reads this and injects it into the next session.
 */
export function saveSessionState(data: SessionStateData): void {
  try {
    mkdirSync(CLAUDITOR_DIR, { recursive: true })

    const filesList = data.filesModified.length > 0
      ? data.filesModified.slice(0, 15).join(', ')
      : 'none tracked'

    const content = [
      `# Last Session (saved by clauditor)`,
      ``,
      `- **Saved at:** ${data.savedAt}`,
      `- **Branch:** ${data.branch || 'unknown'}`,
      `- **Project:** ${data.cwd || 'unknown'}`,
      `- **Session size:** ${data.turns} turns, ${data.tokensPerTurn}k tokens/turn`,
      `- **Waste factor:** ${data.wasteFactor}x`,
      `- **Files modified:** ${filesList}`,
      ``,
    ].join('\n')

    writeFileSync(LAST_SESSION_FILE, content)
  } catch {}
}

/**
 * Read the last session state. Returns null if no state saved.
 */
export function readLastSessionState(): string | null {
  try {
    return readFileSync(LAST_SESSION_FILE, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Extract session state data from a JSONL transcript.
 */
export function extractSessionStateFromTranscript(
  sessionId: string,
  transcriptPath: string
): SessionStateData | null {
  try {
    const content = readFileSync(transcriptPath, 'utf-8')
    const lines = content.split('\n')

    let cwd: string | null = null
    let branch: string | null = null
    let turnCount = 0
    const turnTokens: number[] = []
    const filesModified = new Set<string>()

    // Get cwd and branch from most recent user record
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const r = JSON.parse(lines[i])
        if (r.type === 'user' && r.cwd) {
          cwd = r.cwd
          branch = r.gitBranch || null
          break
        }
      } catch {}
    }

    // Scan all records for turns and files
    for (const line of lines) {
      try {
        const r = JSON.parse(line)
        if (r.type === 'assistant' && r.message?.usage) {
          const u = r.message.usage
          const total = (u.input_tokens || 0) + (u.output_tokens || 0) +
            (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
          turnTokens.push(total)
          turnCount++
        }
        if (r.type === 'assistant' && r.message?.content) {
          for (const block of r.message.content) {
            if (block.type === 'tool_use' && (block.name === 'Edit' || block.name === 'Write')) {
              const fp = block.input?.file_path
              if (fp) filesModified.add(fp.split('/').pop() || fp)
            }
          }
        }
      } catch {}
    }

    if (turnTokens.length < 5) return null

    const baseline = turnTokens.slice(0, 5).reduce((a, b) => a + b, 0) / 5
    const current = turnTokens.slice(-5).reduce((a, b) => a + b, 0) / 5
    const wasteFactor = baseline > 0 ? Math.round(current / baseline) : 1

    return {
      savedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      branch,
      turns: turnCount,
      tokensPerTurn: Math.round(current / 1000),
      wasteFactor,
      filesModified: Array.from(filesModified),
      cwd,
    }
  } catch {
    return null
  }
}

/**
 * Find transcript path for a session ID.
 */
export function findTranscriptPathSync(sessionId: string): string | null {
  const projectsDir = resolve(homedir(), '.claude/projects')
  try {
    const dirs = readdirSync(projectsDir, { withFileTypes: true })
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue
      const candidate = resolve(projectsDir, dir.name, `${sessionId}.jsonl`)
      try {
        readFileSync(candidate, { flag: 'r' })
        return candidate
      } catch {}
    }
  } catch {}
  return null
}
