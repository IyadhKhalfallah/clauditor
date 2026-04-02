import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

const CONFIG_DIR = resolve(homedir(), '.clauditor')
const CONFIG_FILE = resolve(CONFIG_DIR, 'config.json')

export interface ClauditorUserConfig {
  rotation: {
    enabled: boolean
    threshold: number
    minTurns: number
  }
  notifications: {
    desktop: boolean
  }
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
    }
  } catch {
    return { ...DEFAULTS }
  }
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
