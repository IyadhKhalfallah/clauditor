/**
 * Windsurf hook manager — installs/uninstalls clauditor hooks
 * into ~/.codeium/windsurf/hooks.json.
 *
 * Windsurf has 12 hook events. Pre-hooks can block with exit code 2.
 * Hook stdin: { agent_action_name, trajectory_id, execution_id, timestamp, tool_info }
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { HookManager, CanonicalHookEvent } from '../types.js'
import type { HookDecision } from '../../types.js'

const WINDSURF_HOOKS_PATH = resolve(homedir(), '.codeium/windsurf/hooks.json')
const CLAUDITOR_MARKER = 'clauditor hook'

const EVENT_MAP: Record<CanonicalHookEvent, string | null> = {
  session_start: null,
  user_prompt_submit: 'pre_user_prompt',
  pre_tool_use: 'pre_run_command',
  post_tool_use: 'post_run_command',
  pre_compact: null,
  post_compact: null,
  stop: 'post_cascade_response_with_transcript',
}

interface WindsurfHookEntry {
  command: string
  show_output?: boolean
  working_directory?: string
}

interface WindsurfHooksFile {
  hooks: Record<string, WindsurfHookEntry[]>
}

function getHookCommand(subcommand: string): string {
  const isNpx = process.argv[1]?.includes('_npx') || process.env.npm_execpath?.includes('npx')
  if (isNpx) {
    return `npx -y @iyadhk/clauditor hook ${subcommand} --provider windsurf`
  }
  return `clauditor hook ${subcommand} --provider windsurf`
}

const HOOK_COMMANDS: Record<string, string> = {
  pre_user_prompt: getHookCommand('user-prompt-submit'),
  pre_run_command: getHookCommand('pre-tool-use'),
  post_run_command: getHookCommand('post-tool-use'),
  pre_write_code: getHookCommand('pre-tool-use'),
  post_write_code: getHookCommand('post-tool-use'),
  post_cascade_response_with_transcript: getHookCommand('stop'),
}

async function readHooksFile(): Promise<WindsurfHooksFile> {
  try {
    const content = await readFile(WINDSURF_HOOKS_PATH, 'utf-8')
    return JSON.parse(content)
  } catch {
    return { hooks: {} }
  }
}

async function writeHooksFile(data: WindsurfHooksFile): Promise<void> {
  await mkdir(dirname(WINDSURF_HOOKS_PATH), { recursive: true })
  await writeFile(WINDSURF_HOOKS_PATH, JSON.stringify(data, null, 2) + '\n')
}

export const windsurfHooks: HookManager = {
  supportedEvents: [
    'user_prompt_submit',
    'pre_tool_use',
    'post_tool_use',
    'stop',
  ] as CanonicalHookEvent[],

  blockExitCode: 2, // Same as Claude

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

      file.hooks[eventName].push({ command, show_output: true })
      messages.push(`${eventName}: ✓ installed`)
    }

    await writeHooksFile(file)
    messages.push(`\nHooks written to ${WINDSURF_HOOKS_PATH}`)
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
    messages.push(`\nHooks written to ${WINDSURF_HOOKS_PATH}`)
    return messages
  },

  formatOutput(decision: HookDecision): string {
    return JSON.stringify(decision)
  },
}
