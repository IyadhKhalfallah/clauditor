/**
 * Codex CLI hook manager — installs/uninstalls clauditor hooks
 * into ~/.codex/hooks.json.
 *
 * Codex uses the same 5 hook events as Claude Code with a nearly
 * identical format — the main difference is the config file location
 * and the JSON structure.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { HookManager, CanonicalHookEvent } from '../types.js'
import type { HookDecision } from '../../types.js'

const CODEX_HOOKS_PATH = resolve(homedir(), '.codex/hooks.json')
const CLAUDITOR_MARKER = 'clauditor hook'

const EVENT_MAP: Record<CanonicalHookEvent, string | null> = {
  session_start: 'SessionStart',
  user_prompt_submit: 'UserPromptSubmit',
  pre_tool_use: 'PreToolUse',
  post_tool_use: 'PostToolUse',
  pre_compact: null, // Codex doesn't have pre/post compact
  post_compact: null,
  stop: 'Stop',
}

interface CodexHookEntry {
  matcher?: string
  hooks: Array<{ type: 'command'; command: string; timeoutSec?: number }>
}

interface CodexHooksFile {
  hooks: Record<string, CodexHookEntry[]>
}

function getHookCommand(subcommand: string): string {
  const isNpx = process.argv[1]?.includes('_npx') || process.env.npm_execpath?.includes('npx')
  if (isNpx) {
    return `npx -y @iyadhk/clauditor hook ${subcommand} --provider codex`
  }
  return `clauditor hook ${subcommand} --provider codex`
}

const HOOK_COMMANDS: Record<string, string> = {
  UserPromptSubmit: getHookCommand('user-prompt-submit'),
  PreToolUse: getHookCommand('pre-tool-use'),
  PostToolUse: getHookCommand('post-tool-use'),
  SessionStart: getHookCommand('session-start'),
  Stop: getHookCommand('stop'),
}

async function readHooksFile(): Promise<CodexHooksFile> {
  try {
    const content = await readFile(CODEX_HOOKS_PATH, 'utf-8')
    return JSON.parse(content)
  } catch {
    return { hooks: {} }
  }
}

async function writeHooksFile(data: CodexHooksFile): Promise<void> {
  await mkdir(dirname(CODEX_HOOKS_PATH), { recursive: true })
  await writeFile(CODEX_HOOKS_PATH, JSON.stringify(data, null, 2) + '\n')
}

export const codexHooks: HookManager = {
  supportedEvents: [
    'session_start',
    'user_prompt_submit',
    'pre_tool_use',
    'post_tool_use',
    'stop',
  ] as CanonicalHookEvent[],

  blockExitCode: 2,

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

      const alreadyInstalled = file.hooks[eventName].some(entry =>
        entry.hooks.some(h => h.command.includes(CLAUDITOR_MARKER))
      )

      if (alreadyInstalled) {
        messages.push(`${eventName}: already installed (skipped)`)
        continue
      }

      file.hooks[eventName].push({
        hooks: [{ type: 'command', command }],
      })
      messages.push(`${eventName}: ✓ installed`)
    }

    await writeHooksFile(file)
    messages.push(`\nHooks written to ${CODEX_HOOKS_PATH}`)
    return messages
  },

  async uninstall(): Promise<string[]> {
    const file = await readHooksFile()
    const messages: string[] = []

    for (const eventName of Object.keys(file.hooks)) {
      const before = file.hooks[eventName].length
      file.hooks[eventName] = file.hooks[eventName].filter(
        entry => !entry.hooks.some(h => h.command.includes(CLAUDITOR_MARKER))
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
    messages.push(`\nHooks written to ${CODEX_HOOKS_PATH}`)
    return messages
  },

  formatOutput(decision: HookDecision): string {
    return JSON.stringify(decision)
  },
}
