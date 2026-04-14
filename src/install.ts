import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { t } from './i18n.js'

const DEFAULT_CLAUDE_DIR = resolve(homedir(), '.claude')

function settingsPath(claudeDir?: string): string {
  return resolve(claudeDir ?? DEFAULT_CLAUDE_DIR, 'settings.json')
}

function skillDir(claudeDir?: string): string {
  return resolve(claudeDir ?? DEFAULT_CLAUDE_DIR, 'skills/save-skill')
}

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

// Detect if running via npx — if so, hooks need the npx prefix
function getHookCommand(subcommand: string): string {
  const isNpx = process.argv[1]?.includes('_npx') || process.env.npm_execpath?.includes('npx')
  if (isNpx) {
    return `npx -y @iyadhk/clauditor hook ${subcommand}`
  }
  return `clauditor hook ${subcommand}`
}

const CLAUDITOR_HOOKS: Record<string, HookEventConfig> = {
  UserPromptSubmit: {
    matcher: '',
    hooks: [{ type: 'command', command: getHookCommand('user-prompt-submit') }],
  },
  PreCompact: {
    matcher: '',
    hooks: [{ type: 'command', command: getHookCommand('pre-compact') }],
  },
  PostCompact: {
    matcher: '',
    hooks: [{ type: 'command', command: getHookCommand('post-compact') }],
  },
  SessionStart: {
    matcher: '',
    hooks: [{ type: 'command', command: getHookCommand('session-start') }],
  },
  Stop: {
    matcher: '',
    hooks: [{ type: 'command', command: getHookCommand('stop') }],
  },
  PostToolUse: {
    matcher: '',
    hooks: [{ type: 'command', command: getHookCommand('post-tool-use') }],
  },
}

const CLAUDITOR_MARKER = 'clauditor hook'

/**
 * Install clauditor hooks into ~/.claude/settings.json.
 * Merges non-destructively — preserves existing hooks.
 */
export async function installHooks(claudeDir?: string): Promise<string[]> {
  const settings = await readSettings(claudeDir)
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
      messages.push(t('install.alreadyInstalled', { event: eventName }))
      continue
    }

    // Check for potential conflicts
    const conflicting = existingHooks.filter(
      (config) =>
        config.matcher === hookConfig.matcher &&
        !config.hooks.some((h) => h.command.includes(CLAUDITOR_MARKER))
    )

    if (conflicting.length > 0) {
      messages.push(t('install.conflict', { event: eventName, matcher: hookConfig.matcher }))
    }

    existingHooks.push(hookConfig)
    messages.push(t('install.installed', { event: eventName }))
  }

  await writeSettings(settings, claudeDir)
  messages.push(t('install.settingsWritten', { path: settingsPath(claudeDir) }))

  // Install the /save-skill skill
  const skillMessages = await installSaveSkill(claudeDir)
  messages.push(...skillMessages)

  // Write config if not present
  const { writeConfigIfMissing } = await import('./config.js')
  writeConfigIfMissing()

  // Auto-calibrate from session history
  const { calibrate } = await import('./features/calibration.js')
  const cal = calibrate()
  if (cal.confident) {
    messages.push(t('install.calibrated', { threshold: cal.wasteThreshold, minTurns: cal.minTurns, sessions: cal.sessionsAnalyzed }))
  } else {
    messages.push(t('install.conservative'))
  }

  return messages
}

/**
 * Install the /save-skill skill to the user's personal skills directory.
 */
async function installSaveSkill(claudeDir?: string): Promise<string[]> {
  const messages: string[] = []
  const dir = skillDir(claudeDir)
  const skillPath = resolve(dir, 'SKILL.md')

  try {
    // Check if already installed
    try {
      await access(skillPath)
      messages.push(t('install.skillAlreadyInstalled'))
      return messages
    } catch {
      // Not installed yet
    }

    await mkdir(dir, { recursive: true })

    // Find the bundled SKILL.md — it's in the package's skills/ directory
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const bundledSkill = resolve(__dirname, '..', 'src', 'skills', 'save-skill', 'SKILL.md')

    // Try bundled location first, fall back to writing inline
    try {
      await access(bundledSkill)
      await copyFile(bundledSkill, skillPath)
    } catch {
      // Bundled file not found (running from dist/) — write it directly
      const skillContent = SAVE_SKILL_CONTENT
      await writeFile(skillPath, skillContent)
    }

    const displayDir = dir.replace(homedir(), '~')
    messages.push(t('install.skillInstalled', { dir: displayDir }))
  } catch (err) {
    messages.push(t('install.skillFailed', { error: String(err) }))
  }

  return messages
}

const SAVE_SKILL_CONTENT = `---
name: save-skill
description: Save what we just did as a reusable skill. Use at the end of a session to capture a workflow, technique, or process that you want to repeat.
disable-model-invocation: true
---

The user wants to save what was done in this session as a reusable Claude Code skill.

## Steps

1. **Review the session**: Look at what was accomplished — the tools used, files modified, commands run, and the overall workflow.

2. **Identify the reusable pattern**: What was the core workflow or technique? Strip away project-specific details and extract the generalizable process.

3. **Ask the user**:
   - "What should this skill be called?" (suggest a name based on what was done)
   - "Should this be a project skill (.claude/skills/) or a personal skill (~/.claude/skills/)?"
   - "Should only you be able to invoke it, or should Claude use it automatically when relevant?"

4. **Create the skill**: Write the SKILL.md file with:
   - YAML frontmatter: name, description, and \\\`disable-model-invocation: true\\\` if user-only
   - Clear step-by-step instructions based on what was done
   - Use \\\`$ARGUMENTS\\\` for any variable parts (file names, branch names, etc.)
   - Keep it under 500 lines — move detailed reference to supporting files if needed

5. **Verify**: Show the user the created skill and explain how to invoke it with /skill-name.

## Important

- Don't include project-specific file paths — use patterns like "src/routes/" not absolute paths
- Include any commands that should be run (test, lint, build)
- If the workflow has multiple variants, use $ARGUMENTS to parameterize
`

/**
 * Remove clauditor hooks from ~/.claude/settings.json.
 */
export async function uninstallHooks(claudeDir?: string): Promise<string[]> {
  const settings = await readSettings(claudeDir)
  const messages: string[] = []

  if (!settings.hooks) {
    messages.push(t('install.nothingToRemove'))
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
      messages.push(t('install.removed', { event: eventName, count: removed }))
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

  await writeSettings(settings, claudeDir)
  messages.push(t('install.settingsWritten', { path: settingsPath(claudeDir) }))

  // Remove /save-skill
  const dir = skillDir(claudeDir)
  const saveSkillPath = resolve(dir, 'SKILL.md')
  try {
    await access(saveSkillPath)
    const { rm } = await import('node:fs/promises')
    await rm(dir, { recursive: true })
    messages.push(t('install.skillRemoved'))
  } catch {
    // Not installed
  }

  return messages
}

async function readSettings(claudeDir?: string): Promise<ClaudeSettings> {
  try {
    const content = await readFile(settingsPath(claudeDir), 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

async function writeSettings(settings: ClaudeSettings, claudeDir?: string): Promise<void> {
  const p = settingsPath(claudeDir)
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(settings, null, 2) + '\n')
}
