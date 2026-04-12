/**
 * Claude Code provider — the original and primary clauditor integration.
 */
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import type { Provider } from '../types.js'
import { claudeParser } from './parser.js'
import { claudeDiscovery } from './discovery.js'
import { claudePricing } from './pricing.js'
import { claudeTools } from './tools.js'
import { claudeHooks } from './hooks.js'

export const claudeProvider: Provider = {
  name: 'claude',
  displayName: 'Claude Code',
  tier: 1,

  directories: {
    sessionsDir: () => resolve(homedir(), '.claude/projects'),
    configDir: () => resolve(homedir(), '.claude'),
    stateDir: () => resolve(homedir(), '.clauditor'),
  },

  parser: claudeParser,
  discovery: claudeDiscovery,
  pricing: claudePricing,
  tools: claudeTools,
  hooks: claudeHooks,

  getContextLimit(model: string): number {
    if (model.includes('opus')) return 1_000_000
    if (model.includes('haiku')) return 200_000
    return 200_000 // Sonnet default
  },
}
