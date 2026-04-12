/**
 * OpenAI Codex CLI provider.
 *
 * Codex has a nearly identical architecture to Claude Code:
 * - JSONL session files in ~/.codex/sessions/
 * - Same 5 hook events (PreToolUse, PostToolUse, UserPromptSubmit, SessionStart, Stop)
 * - hooks.json config format (vs Claude's settings.json)
 */
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import type { Provider } from '../types.js'
import { codexParser } from './parser.js'
import { codexDiscovery } from './discovery.js'
import { codexPricing } from './pricing.js'
import { codexTools } from './tools.js'
import { codexHooks } from './hooks.js'

export const codexProvider: Provider = {
  name: 'codex',
  displayName: 'Codex CLI',
  tier: 1,

  directories: {
    sessionsDir: () => resolve(homedir(), '.codex/sessions'),
    configDir: () => resolve(homedir(), '.codex'),
    stateDir: () => resolve(homedir(), '.clauditor'),
  },

  parser: codexParser,
  discovery: codexDiscovery,
  pricing: codexPricing,
  tools: codexTools,
  hooks: codexHooks,

  getContextLimit(model: string): number {
    if (model.includes('o3-pro')) return 200_000
    if (model.includes('o3') || model.includes('o4')) return 200_000
    if (model.includes('gpt-4.1')) return 1_047_576
    return 200_000
  },
}
