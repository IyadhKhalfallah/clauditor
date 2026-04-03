import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { saveSessionState as saveSState, extractSessionStateFromTranscript } from '../features/session-state.js'
import { readConfig } from '../config.js'
import { loadCalibration } from '../features/calibration.js'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { logActivity } from '../features/activity-log.js'

/**
 * UserPromptSubmit hook — fires BEFORE Claude processes the user's prompt.
 *
 * This is the breakthrough: we can BLOCK before any tokens are wasted.
 * If the session's waste factor is too high, we block the prompt and
 * show the user exactly why and what to do.
 *
 * The user sees this BEFORE burning another 300k tokens on a turn.
 */

interface UserPromptSubmitInput {
  session_id: string
  transcript_path?: string
  cwd?: string
  hook_event_name: 'UserPromptSubmit'
  prompt?: string
}

// Thresholds are auto-calibrated from user's session history.
// See src/features/calibration.ts for the algorithm.
const BLOCK_NUDGE_FILE = resolve(homedir(), '.clauditor', 'prompt-block-nudge.json')

export async function handleUserPromptSubmitHook(): Promise<void> {
  const input = await readStdin()
  let hookInput: UserPromptSubmitInput

  try {
    hookInput = JSON.parse(input)
  } catch {
    process.stdout.write('{}')
    return
  }

  // Check config
  const config = readConfig()
  if (!config.rotation.enabled) {
    process.stdout.write('{}')
    return
  }

  // Check if already blocked this session (only block once)
  let blocked: Record<string, boolean> = {}
  try {
    blocked = JSON.parse(readFileSync(BLOCK_NUDGE_FILE, 'utf-8'))
  } catch {}

  // Skip if already blocked by either UserPromptSubmit or PostToolUse
  if (blocked[hookInput.session_id] || blocked[`post-${hookInput.session_id}`]) {
    process.stdout.write('{}')
    return
  }

  try {
    const sessionId = hookInput.session_id
    const transcriptPath = hookInput.transcript_path || findTranscriptPathSync(sessionId)
    if (!transcriptPath) {
      process.stdout.write('{}')
      return
    }

    const analysis = analyzeSession(transcriptPath)
    const cal = loadCalibration()
    if (!analysis || analysis.turns < cal.minTurns) {
      process.stdout.write('{}')
      return
    }

    const wasteFactor = analysis.baseline > 0
      ? Math.round(analysis.current / analysis.baseline)
      : 0

    if (wasteFactor < cal.wasteThreshold) {
      process.stdout.write('{}')
      return
    }

    // BLOCK — save context and tell the user
    blocked[sessionId] = true
    try {
      mkdirSync(resolve(homedir(), '.clauditor'), { recursive: true })
      writeFileSync(BLOCK_NUDGE_FILE, JSON.stringify(blocked))
    } catch {}

    // Save rich session state to ~/.clauditor/last-session.md
    // Use transcript extraction for full context (commits, commands, user messages)
    const richState = extractSessionStateFromTranscript(sessionId, transcriptPath)
    if (richState) {
      saveSState(richState)
    } else {
      // Fallback to basic metadata
      saveSState({
        savedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        branch: analysis.branch,
        turns: analysis.turns,
        tokensPerTurn: Math.round(analysis.current / 1000),
        wasteFactor,
        filesModified: analysis.filesModified,
        cwd: analysis.cwd,
        originalTask: null,
        recentUserMessages: [],
        gitCommits: [],
        keyCommands: [],
        filesRead: [],
      })
    }

    logActivity({
      type: 'context_warning',
      session: sessionId.slice(0, 8),
      message: `BLOCKED prompt — ${wasteFactor}x waste factor (${Math.round(analysis.current / 1000)}k/turn vs ${Math.round(analysis.baseline / 1000)}k baseline)`,
    }).catch(() => {})

    // Output block decision
    const filesList = analysis.filesModified.length > 0
      ? analysis.filesModified.slice(0, 10).join(', ')
      : 'none tracked'

    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason:
        `\n╔══════════════════════════════════════════════════════════════╗\n` +
        `║  clauditor: Session using ${wasteFactor}x more quota than necessary  ║\n` +
        `╚══════════════════════════════════════════════════════════════╝\n\n` +
        `Your turns started at ${Math.round(analysis.baseline / 1000)}k tokens.\n` +
        `They're now at ${Math.round(analysis.current / 1000)}k tokens.\n` +
        `Each turn uses ${wasteFactor}x more quota than when this session started.\n\n` +
        `Session state saved.\n` +
        `  Branch: ${analysis.branch || 'unknown'}\n` +
        `  Files: ${filesList}\n` +
        `  Turns: ${analysis.turns}\n\n` +
        `Start fresh: run \`claude\` — clauditor will inject your previous session context.\n` +
        `Or press Enter to continue in this session (not recommended).`,
    }))
  } catch {
    process.stdout.write('{}')
  }
}

interface SessionAnalysis {
  turns: number
  baseline: number      // avg tokens/turn for first 5 turns
  current: number       // avg tokens/turn for last 5 turns
  cwd: string | null
  branch: string | null
  filesModified: string[]
}

function analyzeSession(transcriptPath: string): SessionAnalysis | null {
  try {
    const content = readFileSync(transcriptPath, 'utf-8')
    const lines = content.split('\n')

    const turnTokens: number[] = []
    const filesModified = new Set<string>()
    let cwd: string | null = null
    let branch: string | null = null

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const r = JSON.parse(lines[i])
        if (r.type === 'user' && r.cwd && !cwd) {
          cwd = r.cwd
          branch = r.gitBranch || null
        }
      } catch {}
    }

    for (const line of lines) {
      try {
        const r = JSON.parse(line)
        if (r.type === 'assistant' && r.message?.usage) {
          const u = r.message.usage
          const total = (u.input_tokens || 0) + (u.output_tokens || 0) +
            (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
          turnTokens.push(total)
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

    if (turnTokens.length < 20) return null // minimum for analysis, not blocking

    const baseline = turnTokens.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(5, turnTokens.length)
    const current = turnTokens.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, turnTokens.length)

    return {
      turns: turnTokens.length,
      baseline,
      current,
      cwd,
      branch,
      filesModified: Array.from(filesModified),
    }
  } catch {
    return null
  }
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

handleUserPromptSubmitHook().catch((err) => {
  process.stderr.write(`clauditor user-prompt-submit hook error: ${err}\n`)
  process.stdout.write('{}')
  process.exit(0)
})
