/**
 * Claude Code hook manager — installs/uninstalls clauditor hooks
 * into ~/.claude/settings.json.
 */
import type { HookManager, CanonicalHookEvent } from '../types.js'
import type { HookDecision } from '../../types.js'
import { installHooks, uninstallHooks } from '../../install.js'

const EVENT_MAP: Record<CanonicalHookEvent, string> = {
  session_start: 'SessionStart',
  user_prompt_submit: 'UserPromptSubmit',
  pre_tool_use: 'PreToolUse',
  post_tool_use: 'PostToolUse',
  pre_compact: 'PreCompact',
  post_compact: 'PostCompact',
  stop: 'Stop',
}

export const claudeHooks: HookManager = {
  supportedEvents: [
    'session_start',
    'user_prompt_submit',
    'post_tool_use',
    'pre_compact',
    'post_compact',
    'stop',
  ] as CanonicalHookEvent[],

  blockExitCode: 2,

  eventName(canonical: CanonicalHookEvent): string | null {
    return EVENT_MAP[canonical] ?? null
  },

  async install(): Promise<string[]> {
    return installHooks()
  },

  async uninstall(): Promise<string[]> {
    return uninstallHooks()
  },

  formatOutput(decision: HookDecision): string {
    return JSON.stringify(decision)
  },
}
