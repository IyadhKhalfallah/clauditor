import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
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

  // Install the /save-skill skill to ~/.claude/skills/save-skill/
  const skillMessages = await installSaveSkill()
  messages.push(...skillMessages)

  // Write config if not present
  const { writeConfigIfMissing } = await import('./config.js')
  writeConfigIfMissing()

  // Auto-calibrate from session history
  const { calibrate } = await import('./features/calibration.js')
  const cal = calibrate()
  if (cal.confident) {
    messages.push(`Session rotation: ✓ calibrated — blocks at ${cal.wasteThreshold}x waste, ${cal.minTurns}+ turns (from ${cal.sessionsAnalyzed} sessions)`)
  } else {
    messages.push(`Session rotation: ✓ enabled — using conservative 10x threshold (will auto-calibrate after more sessions)`)
  }

  return messages
}

/**
 * Install the /save-skill skill to the user's personal skills directory.
 */
async function installSaveSkill(): Promise<string[]> {
  const messages: string[] = []
  const skillDir = resolve(homedir(), '.claude/skills/save-skill')
  const skillPath = resolve(skillDir, 'SKILL.md')

  try {
    // Check if already installed
    try {
      await access(skillPath)
      messages.push('/save-skill: already installed (skipped)')
      return messages
    } catch {
      // Not installed yet
    }

    await mkdir(skillDir, { recursive: true })

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

    messages.push('/save-skill: ✓ installed to ~/.claude/skills/save-skill/')
  } catch (err) {
    messages.push(`/save-skill: ⚠ failed to install — ${err}`)
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

  // Remove /save-skill
  const skillPath = resolve(homedir(), '.claude/skills/save-skill/SKILL.md')
  try {
    await access(skillPath)
    const { rm } = await import('node:fs/promises')
    await rm(resolve(homedir(), '.claude/skills/save-skill'), { recursive: true })
    messages.push('/save-skill: ✓ removed')
  } catch {
    // Not installed
  }

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
