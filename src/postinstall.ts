/**
 * Postinstall script — auto-registers any MISSING hooks on npm upgrade.
 *
 * Only runs if the user has already run `clauditor install` (at least one
 * clauditor hook exists in settings.json). This respects audit-only users
 * who intentionally skip hook registration.
 *
 * Silent on failure (|| true in package.json).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

const SETTINGS_PATH = resolve(homedir(), '.claude/settings.json')
const CLAUDITOR_MARKER = 'clauditor hook'

const REQUIRED_HOOKS: Record<string, string> = {
  UserPromptSubmit: 'clauditor hook user-prompt-submit',
  PreCompact: 'clauditor hook pre-compact',
  PostCompact: 'clauditor hook post-compact',
  SessionStart: 'clauditor hook session-start',
  Stop: 'clauditor hook stop',
  PostToolUse: 'clauditor hook post-tool-use',
  PreToolUse: 'clauditor hook pre-tool-use',
}

try {
  // Only run if Claude Code is installed
  if (!existsSync(resolve(homedir(), '.claude'))) {
    process.exit(0)
  }

  // Read existing settings
  let settings: Record<string, unknown> = {}
  try {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
  } catch {
    // No settings file — user hasn't set up Claude Code yet
    process.exit(0)
  }

  const hooks = settings.hooks as Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>> | undefined
  if (!hooks) {
    // No hooks at all — user is in audit-only mode or hasn't installed
    process.exit(0)
  }

  // Check if at least one clauditor hook exists (user ran `clauditor install` before)
  const hasClauditor = Object.values(hooks).some(configs =>
    configs.some(config => config.hooks?.some(h => h.command?.includes(CLAUDITOR_MARKER)))
  )

  if (!hasClauditor) {
    // No clauditor hooks — respect audit-only mode
    process.exit(0)
  }

  // User has clauditor hooks — check for missing ones and add them
  let added = 0
  for (const [eventName, command] of Object.entries(REQUIRED_HOOKS)) {
    if (!hooks[eventName]) {
      hooks[eventName] = []
    }

    const alreadyInstalled = hooks[eventName].some(config =>
      config.hooks?.some(h => h.command?.includes(CLAUDITOR_MARKER))
    )

    if (!alreadyInstalled) {
      hooks[eventName].push({
        matcher: '',
        hooks: [{ type: 'command', command }],
      })
      added++
    }
  }

  if (added > 0) {
    settings.hooks = hooks
    mkdirSync(resolve(homedir(), '.claude'), { recursive: true })
    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n')
    console.log(`clauditor: registered ${added} new hook(s) in ~/.claude/settings.json`)
  }
} catch {
  // Silent failure — don't break npm install
}
