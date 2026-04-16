import { spawn } from 'node:child_process'
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { logActivity } from '../features/activity-log.js'

const ROTATION_EXIT_CODE = 2
const MIN_SESSION_MS = 5000 // if claude exits in <5s, likely a crash — don't restart

export interface RunOptions {
  maxRestarts: number
  task?: string
}

export interface RunResult {
  exitCode: number
  restarts: number
  reason: 'normal_exit' | 'signal' | 'max_restarts' | 'crash_loop' | 'spawn_error'
}

/**
 * Run `claude` with auto-restart on session rotation.
 *
 * When clauditor's UserPromptSubmit hook blocks a session (exit code 2),
 * this restarts `claude` automatically. The SessionStart hook injects
 * the saved context into the fresh session — zero manual steps.
 */
export async function runWithAutoRotation(opts: RunOptions): Promise<void> {
  preflight()
  const result = await runLoop(opts)

  if (result.reason === 'max_restarts') {
    console.log(`\n  clauditor: max restarts (${opts.maxRestarts}) reached. Exiting.\n`)
  }

  process.exit(result.exitCode)
}

/**
 * Core loop — returns instead of calling process.exit, making it testable.
 */
export async function runLoop(opts: RunOptions): Promise<RunResult> {
  let restarts = 0

  while (restarts <= opts.maxRestarts) {
    const args: string[] = []
    if (opts.task && restarts === 0) {
      args.push('-p', opts.task)
    }

    if (restarts > 0) {
      console.log(`\n  clauditor: session rotated — restarting (${restarts}/${opts.maxRestarts})...\n`)
    }

    const startTime = Date.now()

    const { code, signal } = await spawnClaude(args)

    const elapsed = Date.now() - startTime

    // Spawn error
    if (code === -1) {
      return { exitCode: 1, restarts, reason: 'spawn_error' }
    }

    // User quit (Ctrl+C / Ctrl+D) or normal exit — stop
    if (signal === 'SIGINT' || signal === 'SIGTERM') {
      return { exitCode: 0, restarts, reason: 'signal' }
    }

    if (code !== ROTATION_EXIT_CODE) {
      return { exitCode: code ?? 0, restarts, reason: 'normal_exit' }
    }

    // Exit code 2 = rotation block — restart
    // But if the session lasted <5s, it's probably a crash loop
    if (elapsed < MIN_SESSION_MS) {
      console.error('\n  ✗ claude exited too quickly after restart — possible crash loop. Stopping.')
      return { exitCode: 1, restarts, reason: 'crash_loop' }
    }

    restarts++
    logActivity({
      type: 'auto_rotation',
      session: `restart-${restarts}`,
      message: `Auto-restarted session (${restarts}/${opts.maxRestarts})`,
    }).catch(() => {})
  }

  return { exitCode: 0, restarts, reason: 'max_restarts' }
}

/**
 * Preflight checks — run once before the loop.
 */
function preflight(): void {
  // Check claude is installed
  try {
    execSync('which claude', { stdio: 'ignore' })
  } catch {
    console.error('\n  ✗ `claude` CLI not found in PATH.')
    console.error('    Install it first: https://docs.anthropic.com/en/docs/claude-code')
    process.exit(1)
  }

  // Warn if hooks aren't installed
  const settingsPath = resolve(homedir(), '.claude', 'settings.json')
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      const hasClauditorHooks = JSON.stringify(settings.hooks || {}).includes('clauditor hook')
      if (!hasClauditorHooks) {
        console.log('\n  ⚠ clauditor hooks not detected in ~/.claude/settings.json')
        console.log('    Auto-rotation requires hooks. Run `clauditor install` first.\n')
      }
    } catch {}
  } else {
    console.log('\n  ⚠ ~/.claude/settings.json not found — hooks may not be installed.')
    console.log('    Run `clauditor install` to set up hooks.\n')
  }
}

function spawnClaude(args: string[]): Promise<{ code: number | null; signal: string | null }> {
  return new Promise((resolve) => {
    const child = spawn('claude', args, {
      stdio: 'inherit',
      detached: false,
    })

    child.on('error', (err) => {
      console.error(`\n  ✗ Failed to spawn claude: ${err.message}`)
      resolve({ code: -1, signal: null })
    })

    child.on('exit', (code, signal) => {
      resolve({ code, signal })
    })
  })
}
