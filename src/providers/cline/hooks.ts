/**
 * Cline hook manager — installs/uninstalls clauditor hooks
 * into .clinerules/hooks/ directory.
 *
 * Cline hooks are scripts discovered from:
 * 1. .clinerules/hooks/ (workspace)
 * 2. ~/Documents/Cline/Hooks/ (global)
 *
 * Hook output: { cancel: boolean, contextModification: string, errorMessage: string }
 */
import { writeFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import type { HookManager, CanonicalHookEvent } from '../types.js'
import type { HookDecision } from '../../types.js'

const GLOBAL_HOOKS_DIR = resolve(homedir(), 'Documents/Cline/Hooks')
const CLAUDITOR_PREFIX = 'clauditor-'

const EVENT_MAP: Record<CanonicalHookEvent, string | null> = {
  session_start: 'TaskStart',
  user_prompt_submit: 'UserPromptSubmit',
  pre_tool_use: 'PreToolUse',
  post_tool_use: 'PostToolUse',
  pre_compact: 'PreCompact',
  post_compact: null,
  stop: 'TaskComplete',
}

function getHookCommand(subcommand: string): string {
  const isNpx = process.argv[1]?.includes('_npx') || process.env.npm_execpath?.includes('npx')
  if (isNpx) {
    return `npx -y @iyadhk/clauditor hook ${subcommand} --provider cline`
  }
  return `clauditor hook ${subcommand} --provider cline`
}

const HOOK_SCRIPTS: Record<string, { filename: string; command: string }> = {
  PreToolUse: { filename: `${CLAUDITOR_PREFIX}pre-tool-use.sh`, command: getHookCommand('pre-tool-use') },
  PostToolUse: { filename: `${CLAUDITOR_PREFIX}post-tool-use.sh`, command: getHookCommand('post-tool-use') },
  UserPromptSubmit: { filename: `${CLAUDITOR_PREFIX}user-prompt-submit.sh`, command: getHookCommand('user-prompt-submit') },
  TaskStart: { filename: `${CLAUDITOR_PREFIX}session-start.sh`, command: getHookCommand('session-start') },
  TaskComplete: { filename: `${CLAUDITOR_PREFIX}stop.sh`, command: getHookCommand('stop') },
}

export const clineHooks: HookManager = {
  supportedEvents: [
    'session_start',
    'user_prompt_submit',
    'pre_tool_use',
    'post_tool_use',
    'pre_compact',
    'stop',
  ] as CanonicalHookEvent[],

  blockExitCode: 1, // Cline uses { cancel: true } in output

  eventName(canonical: CanonicalHookEvent): string | null {
    return EVENT_MAP[canonical] ?? null
  },

  async install(): Promise<string[]> {
    const messages: string[] = []
    await mkdir(GLOBAL_HOOKS_DIR, { recursive: true })

    for (const [eventName, script] of Object.entries(HOOK_SCRIPTS)) {
      const scriptPath = resolve(GLOBAL_HOOKS_DIR, script.filename)
      const content = `#!/bin/bash\n# Clauditor hook for Cline ${eventName}\n${script.command}\n`

      await writeFile(scriptPath, content, { mode: 0o755 })
      messages.push(`${eventName}: ✓ installed (${script.filename})`)
    }

    messages.push(`\nHook scripts written to ${GLOBAL_HOOKS_DIR}`)
    return messages
  },

  async uninstall(): Promise<string[]> {
    const messages: string[] = []

    try {
      const files = await readdir(GLOBAL_HOOKS_DIR)
      for (const file of files) {
        if (file.startsWith(CLAUDITOR_PREFIX)) {
          await unlink(resolve(GLOBAL_HOOKS_DIR, file))
          messages.push(`✓ removed ${file}`)
        }
      }
    } catch {
      messages.push('No clauditor hooks found')
    }

    return messages
  },

  formatOutput(decision: HookDecision): string {
    if (decision.decision === 'block') {
      return JSON.stringify({
        cancel: true,
        errorMessage: decision.reason || 'Blocked by clauditor',
      })
    }
    if (decision.additionalContext) {
      return JSON.stringify({
        cancel: false,
        contextModification: decision.additionalContext,
      })
    }
    return JSON.stringify({ cancel: false })
  },
}
