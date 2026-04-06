import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

const CONFIG_DIR = resolve(homedir(), '.clauditor')
const CONFIG_FILE = resolve(CONFIG_DIR, 'config.json')

export interface ProjectHubConfig {
  apiKey: string
  url: string
  developerHash: string
  teamName?: string
}

export interface ClauditorUserConfig {
  rotation: {
    enabled: boolean
    threshold: number
    minTurns: number
  }
  notifications: {
    desktop: boolean
  }
  /** @deprecated Use projects map instead */
  hub?: {
    apiKey?: string
    url?: string
    developerHash?: string
  }
  /** Per-project hub config, keyed by normalized git remote URL */
  projects?: Record<string, ProjectHubConfig>
}

const DEFAULTS: ClauditorUserConfig = {
  rotation: {
    enabled: true,
    threshold: 100_000,
    minTurns: 30,
  },
  notifications: {
    desktop: true,
  },
}

/**
 * Read config synchronously — safe for hooks (separate processes).
 * Falls back to defaults if file doesn't exist.
 */
export function readConfig(): ClauditorUserConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
    return {
      rotation: { ...DEFAULTS.rotation, ...raw.rotation },
      notifications: { ...DEFAULTS.notifications, ...raw.notifications },
      hub: raw.hub ? { ...raw.hub } : undefined,
      projects: raw.projects ? { ...raw.projects } : undefined,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

/**
 * Get hub config for a specific project (by normalized git remote URL).
 * Falls back to the legacy global hub config if no per-project config exists.
 */
export function getProjectHubConfig(gitRemoteUrl: string): ProjectHubConfig | null {
  const config = readConfig()

  // Check per-project config first
  if (config.projects?.[gitRemoteUrl]) {
    return config.projects[gitRemoteUrl]
  }

  // Fall back to legacy global hub config
  if (config.hub?.apiKey && config.hub?.developerHash) {
    return {
      apiKey: config.hub.apiKey,
      url: config.hub.url || '',
      developerHash: config.hub.developerHash,
    }
  }

  return null
}

/**
 * Save hub config for a specific project.
 */
export function setProjectHubConfig(gitRemoteUrl: string, hubConfig: ProjectHubConfig): void {
  const config = readConfig()
  if (!config.projects) config.projects = {}
  config.projects[gitRemoteUrl] = hubConfig
  writeConfig(config)
}

/**
 * Write the full config to disk.
 */
export function writeConfig(config: ClauditorUserConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n')
}

/**
 * Write config. Only writes if file doesn't exist (preserves user edits).
 */
export function writeConfigIfMissing(): void {
  try {
    readFileSync(CONFIG_FILE)
    // File exists — don't overwrite
  } catch {
    mkdirSync(CONFIG_DIR, { recursive: true })
    writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULTS, null, 2) + '\n')
  }
}
