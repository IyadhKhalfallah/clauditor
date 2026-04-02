import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { homedir } from 'node:os'

const SETTINGS_PATH = resolve(homedir(), '.claude/settings.json')

interface ClaudeSettings {
  hooks?: Record<string, HookEventConfig[]>
  [key: string]: unknown
}

interface HookEventConfig {
  matcher: string
  hooks: HookCommand[]
}

interface HookCommand {
  type: 'command'
  command: string
}

const CLAUDITOR_HOOKS: Record<string, HookEventConfig> = {
  Stop: {
    matcher: '',
    hooks: [{ type: 'command', command: 'clauditor hook stop' }],
  },
  PostToolUse: {
    matcher: '',
    hooks: [{ type: 'command', command: 'clauditor hook post-tool-use' }],
  },
}

const CLAUDITOR_MARKER = 'clauditor hook'

/**
 * Install clauditor hooks into ~/.claude/settings.json.
 * Merges non-destructively — preserves existing hooks.
 */
export async function installHooks(): Promise<string[]> {
  const settings = await readSettings()
  const messages: string[] = []

  if (!settings.hooks) {
    settings.hooks = {}
  }

  for (const [eventName, hookConfig] of Object.entries(CLAUDITOR_HOOKS)) {
    if (!settings.hooks[eventName]) {
      settings.hooks[eventName] = []
    }

    const existingHooks = settings.hooks[eventName]

    // Check if clauditor hook already exists
    const alreadyInstalled = existingHooks.some((config) =>
      config.hooks.some((h) => h.command.includes(CLAUDITOR_MARKER))
    )

    if (alreadyInstalled) {
      messages.push(`${eventName}: already installed (skipped)`)
      continue
    }

    // Check for potential conflicts
    const conflicting = existingHooks.filter(
      (config) =>
        config.matcher === hookConfig.matcher &&
        !config.hooks.some((h) => h.command.includes(CLAUDITOR_MARKER))
    )

    if (conflicting.length > 0) {
      messages.push(
        `${eventName}: ⚠ existing hook with same matcher "${hookConfig.matcher}" found — adding clauditor alongside it`
      )
    }

    existingHooks.push(hookConfig)
    messages.push(`${eventName}: ✓ installed`)
  }

  await writeSettings(settings)
  messages.push(`\nSettings written to ${SETTINGS_PATH}`)

  return messages
}

/**
 * Remove clauditor hooks from ~/.claude/settings.json.
 */
export async function uninstallHooks(): Promise<string[]> {
  const settings = await readSettings()
  const messages: string[] = []

  if (!settings.hooks) {
    messages.push('No hooks configured — nothing to remove')
    return messages
  }

  for (const eventName of Object.keys(settings.hooks)) {
    const before = settings.hooks[eventName].length

    settings.hooks[eventName] = settings.hooks[eventName].filter(
      (config) =>
        !config.hooks.some((h) => h.command.includes(CLAUDITOR_MARKER))
    )

    const removed = before - settings.hooks[eventName].length
    if (removed > 0) {
      messages.push(`${eventName}: ✓ removed ${removed} clauditor hook(s)`)
    }

    // Clean up empty arrays
    if (settings.hooks[eventName].length === 0) {
      delete settings.hooks[eventName]
    }
  }

  // Clean up empty hooks object
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks
  }

  await writeSettings(settings)
  messages.push(`\nSettings written to ${SETTINGS_PATH}`)

  return messages
}

async function readSettings(): Promise<ClaudeSettings> {
  try {
    const content = await readFile(SETTINGS_PATH, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

async function writeSettings(settings: ClaudeSettings): Promise<void> {
  await mkdir(dirname(SETTINGS_PATH), { recursive: true })
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n')
}
