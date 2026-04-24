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
  projectId?: string     // Hub project UUID — set during login project picker
  projectName?: string   // Friendly project name
  projectHash?: string   // Hub project hash — used in API calls
}

export interface ClauditorUserConfig {
  rotation: {
    enabled: boolean
    threshold: number
    minTurns: number
    /** Optional absolute tokens/turn ceiling. If set, block when a session
     * crosses this value per turn, even if the relative waste factor is
     * low. Complements the ratio-based check for cases where the session
     * started at 50k and merely doubled — still 100k/turn of waste. */
    absoluteBlockTokens?: number
  }
  notifications: {
    desktop: boolean
  }
  /**
   * Turbocharger: one knob that tightens every threshold in clauditor
   * toward maximum savings. Like a turbo on an engine, it trades headroom
   * for power — more aggressive rotation, earlier edit-thrash warnings,
   * tighter output compression, and lower injection budgets. Enable when
   * quota is tight and you're willing to accept a few more "start fresh"
   * nudges in exchange for 2x-3x more work per quota window.
   */
  turbo?: boolean
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
  turbo: false,
}

/**
 * Turbo-mode thresholds. These are the aggressive values every knob snaps
 * to when `turbo: true` is set in config. Each one is documented next to
 * the call site where it's consumed, so enabling turbo is discoverable
 * without having to chase across the repo.
 */
export const TURBO_THRESHOLDS = {
  /** Bash output compression triggers at this many chars (default: 300) */
  bashCompressTriggerChars: 150,
  /** Bash output compression caps at this many chars (default: 1200) */
  bashCompressMaxChars: 600,
  /** Grep rollup triggers at this many matches (default: 60) */
  grepRollupMinMatches: 30,
  /** Glob rollup triggers at this many paths (default: 60) */
  globRollupMinPaths: 30,
  /** WebFetch hard cap in chars (default: 4000) */
  webFetchMaxChars: 2000,
  /** WebSearch line trim threshold (default: 220) */
  webSearchLineCap: 120,
  /** Edit-thrash soft warning at N edits (default: 3) */
  editThrashSoft: 2,
  /** Edit-thrash hard warning at N edits (default: 5) */
  editThrashHard: 4,
  /** Hot-file qualifies at N edits (default: 5) */
  hotFileEditCount: 3,
  /** Hot-file qualifies at N sessions (default: 3) */
  hotFileSessionCount: 2,
  /** Calibration floor — minimum waste threshold (default confident: 3, not confident: 5) */
  calibrationFloor: 2,
} as const

/**
 * Read the turbo flag once. All hooks are separate processes so this
 * re-reads config each time, but the cost is a single small file read.
 */
export function isTurbo(): boolean {
  try {
    return readConfig().turbo === true
  } catch {
    return false
  }
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
      turbo: raw.turbo === true,
      projects: raw.projects ? { ...raw.projects } : undefined,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

/**
 * Get hub config for a specific project (by normalized git remote URL).
 */
export function getProjectHubConfig(gitRemoteUrl: string): ProjectHubConfig | null {
  const config = readConfig()
  return config.projects?.[gitRemoteUrl] ?? null
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
