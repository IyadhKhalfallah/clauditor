/**
 * Cursor IDE provider.
 *
 * Cursor is a VS Code fork with:
 * - SQLite session storage (state.vscdb)
 * - 6 hook events in .cursor/hooks.json
 * - Agent mode with terminal, file edit, search, browser tools
 */
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import type { Provider } from '../types.js'
import { cursorParser } from './parser.js'
import { cursorDiscovery } from './discovery.js'
import { cursorPricing } from './pricing.js'
import { cursorTools } from './tools.js'
import { cursorHooks } from './hooks.js'

function getCursorDataDir(): string {
  if (process.platform === 'darwin') {
    return resolve(homedir(), 'Library/Application Support/Cursor')
  }
  if (process.platform === 'win32') {
    return resolve(process.env.APPDATA || homedir(), 'Cursor')
  }
  return resolve(homedir(), '.config/Cursor')
}

export const cursorProvider: Provider = {
  name: 'cursor',
  displayName: 'Cursor',
  tier: 1,

  directories: {
    sessionsDir: () => resolve(getCursorDataDir(), 'User/globalStorage'),
    configDir: () => resolve(homedir(), '.cursor'),
    stateDir: () => resolve(homedir(), '.clauditor'),
  },

  parser: cursorParser,
  discovery: cursorDiscovery,
  pricing: cursorPricing,
  tools: cursorTools,
  hooks: cursorHooks,

  getContextLimit(model: string): number {
    if (model.includes('gpt-4o')) return 128_000
    if (model.includes('claude') && model.includes('opus')) return 1_000_000
    if (model.includes('claude')) return 200_000
    return 128_000
  },
}
