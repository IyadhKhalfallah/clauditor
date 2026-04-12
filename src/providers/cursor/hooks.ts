/**
 * Cursor hook manager — installs/uninstalls clauditor hooks
 * into ~/.cursor/hooks.json.
 *
 * Cursor has 6 hook events with a different format than Claude/Codex:
 * - beforeSubmitPrompt, beforeShellExecution, beforeMCPExecution,
 *   beforeReadFile, afterFileEdit, stop
 * - Hook output: { continue, permission, userMessage, agentMessage }
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { HookManager, CanonicalHookEvent } from '../types.js'
import type { HookDecision } from '../../types.js'

const CURSOR_HOOKS_PATH = resolve(homedir(), '.cursor/hooks.json')
const CLAUDITOR_MARKER = 'clauditor hook'

const EVENT_MAP: Record<CanonicalHookEvent, string | null> = {
  session_start: null, // Cursor doesn't have a session start hook
  user_prompt_submit: 'beforeSubmitPrompt',
  pre_tool_use: 'beforeShellExecution',
  post_tool_use: 'afterFileEdit',
  pre_compact: null,
  post_compact: null,
  stop: 'stop',
}

interface CursorHookEntry {
  command: string
}

interface CursorHooksFile {
  version: number
  hooks: Record<string, CursorHookEntry[]>
}

function getHookCommand(subcommand: string): string {
  const isNpx = process.argv[1]?.includes('_npx') || process.env.npm_execpath?.includes('npx')
  if (isNpx) {
    return `npx -y @iyadhk/clauditor hook ${subcommand} --provider cursor`
  }
  return `clauditor hook ${subcommand} --provider cursor`
}

const HOOK_COMMANDS: Record<string, string> = {
  beforeSubmitPrompt: getHookCommand('user-prompt-submit'),
  beforeShellExecution: getHookCommand('pre-tool-use'),
  beforeMCPExecution: getHookCommand('pre-tool-use'),
  afterFileEdit: getHookCommand('post-tool-use'),
  stop: getHookCommand('stop'),
}

async function readHooksFile(): Promise<CursorHooksFile> {
  try {
    const content = await readFile(CURSOR_HOOKS_PATH, 'utf-8')
    return JSON.parse(content)
  } catch {
    return { version: 1, hooks: {} }
  }
}

async function writeHooksFile(data: CursorHooksFile): Promise<void> {
  await mkdir(dirname(CURSOR_HOOKS_PATH), { recursive: true })
  await writeFile(CURSOR_HOOKS_PATH, JSON.stringify(data, null, 2) + '\n')
}

export const cursorHooks: HookManager = {
  supportedEvents: [
    'user_prompt_submit',
    'pre_tool_use',
    'post_tool_use',
    'stop',
  ] as CanonicalHookEvent[],

  blockExitCode: 1, // Cursor uses permission: "deny" in output, not exit codes

  eventName(canonical: CanonicalHookEvent): string | null {
    return EVENT_MAP[canonical] ?? null
  },

  async install(): Promise<string[]> {
    const file = await readHooksFile()
    const messages: string[] = []

    for (const [eventName, command] of Object.entries(HOOK_COMMANDS)) {
      if (!file.hooks[eventName]) {
        file.hooks[eventName] = []
      }

      const alreadyInstalled = file.hooks[eventName].some(
        entry => entry.command.includes(CLAUDITOR_MARKER)
      )

      if (alreadyInstalled) {
        messages.push(`${eventName}: already installed (skipped)`)
        continue
      }

      file.hooks[eventName].push({ command })
      messages.push(`${eventName}: ✓ installed`)
    }

    await writeHooksFile(file)
    messages.push(`\nHooks written to ${CURSOR_HOOKS_PATH}`)
    return messages
  },

  async uninstall(): Promise<string[]> {
    const file = await readHooksFile()
    const messages: string[] = []

    for (const eventName of Object.keys(file.hooks)) {
      const before = file.hooks[eventName].length
      file.hooks[eventName] = file.hooks[eventName].filter(
        entry => !entry.command.includes(CLAUDITOR_MARKER)
      )
      const removed = before - file.hooks[eventName].length
      if (removed > 0) {
        messages.push(`${eventName}: ✓ removed ${removed} clauditor hook(s)`)
      }
      if (file.hooks[eventName].length === 0) {
        delete file.hooks[eventName]
      }
    }

    await writeHooksFile(file)
    messages.push(`\nHooks written to ${CURSOR_HOOKS_PATH}`)
    return messages
  },

  formatOutput(decision: HookDecision): string {
    // Translate clauditor's HookDecision to Cursor's format
    if (decision.decision === 'block') {
      return JSON.stringify({
        continue: false,
        permission: 'deny',
        agentMessage: decision.reason || 'Blocked by clauditor',
      })
    }
    if (decision.additionalContext) {
      return JSON.stringify({
        continue: true,
        permission: 'allow',
        agentMessage: decision.additionalContext,
      })
    }
    return JSON.stringify({ continue: true, permission: 'allow' })
  },
}
