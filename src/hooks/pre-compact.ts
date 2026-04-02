import { readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { HookDecision } from '../types.js'
import { logActivity } from '../features/activity-log.js'

/**
 * PreCompact hook — fires right before Claude Code compacts the context.
 *
 * This is the PERFECT moment to save session state to CLAUDE.md:
 * - Compaction is about to erase older context
 * - We know the exact session that's being compacted
 * - We can write before anything is lost
 *
 * No guessing about 95% thresholds. This hook fires at the exact moment.
 */
export async function handlePreCompactHook(): Promise<void> {
  const input = await readStdin()
  let hookInput: { session_id: string; transcript_path?: string; cwd?: string }

  try {
    hookInput = JSON.parse(input)
  } catch {
    outputDecision({})
    return
  }

  try {
    const sessionId = hookInput.session_id
    const transcriptPath = hookInput.transcript_path || findTranscriptPathSync(sessionId)
    if (!transcriptPath) {
      outputDecision({})
      return
    }

    const content = readFileSync(transcriptPath, 'utf-8')
    const lines = content.split('\n')

    // Extract cwd and branch from most recent user record
    let cwd: string | null = null
    let gitBranch: string | null = null
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const r = JSON.parse(lines[i])
        if (r.type === 'user' && r.cwd) {
          cwd = r.cwd
          gitBranch = r.gitBranch || null
          break
        }
      } catch {}
    }

    if (!cwd) {
      outputDecision({})
      return
    }

    // Count turns and extract files modified
    let turnCount = 0
    const filesModified = new Set<string>()
    for (const line of lines) {
      try {
        const r = JSON.parse(line)
        if (r.type === 'assistant' && r.message?.usage) {
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

    // Write session state to CLAUDE.md
    const claudeMdPath = resolve(cwd, 'CLAUDE.md')
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const filesList = filesModified.size > 0
      ? Array.from(filesModified).slice(0, 15).join(', ')
      : 'none tracked'

    const stateBlock = [
      '',
      '## Session State (auto-saved by clauditor before compaction)',
      `- **Saved at:** ${now}`,
      `- **Branch:** ${gitBranch || 'unknown'}`,
      `- **Session size:** ${turnCount} turns`,
      `- **Files modified:** ${filesList}`,
      `- **Action:** Context was compacted. Key decisions and file changes above were preserved.`,
      '',
    ].join('\n')

    let existing = ''
    try {
      existing = readFileSync(claudeMdPath, 'utf-8')
    } catch {}

    if (existing.includes('Session State (auto-saved by clauditor')) {
      existing = existing.replace(
        /\n## Session State \(auto-saved by clauditor[^)]*\)[\s\S]*?(?=\n## |\n$|$)/,
        stateBlock
      )
      writeFileSync(claudeMdPath, existing)
    } else {
      appendFileSync(claudeMdPath, stateBlock)
    }

    logActivity({
      type: 'context_warning',
      session: sessionId.slice(0, 8),
      message: `PreCompact: saved ${turnCount}-turn session state to CLAUDE.md`,
    }).catch(() => {})
  } catch {
    // Non-critical
  }

  outputDecision({})
}

function findTranscriptPathSync(sessionId: string): string | null {
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

handlePreCompactHook().catch((err) => {
  process.stderr.write(`clauditor pre-compact hook error: ${err}\n`)
  process.stdout.write('{}')
  process.exit(0)
})
