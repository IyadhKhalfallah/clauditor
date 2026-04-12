/**
 * Windsurf (Cascade) provider.
 *
 * Windsurf has:
 * - JSONL transcripts in ~/.windsurf/transcripts/
 * - 12 hook events (most of any tool)
 * - Dual-agent architecture (planner + executor)
 */
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import type { Provider } from '../types.js'
import { windsurfParser } from './parser.js'
import { windsurfDiscovery } from './discovery.js'
import { windsurfPricing } from './pricing.js'
import { windsurfTools } from './tools.js'
import { windsurfHooks } from './hooks.js'

export const windsurfProvider: Provider = {
  name: 'windsurf',
  displayName: 'Windsurf',
  tier: 1,

  directories: {
    sessionsDir: () => resolve(homedir(), '.windsurf/transcripts'),
    configDir: () => resolve(homedir(), '.codeium/windsurf'),
    stateDir: () => resolve(homedir(), '.clauditor'),
  },

  parser: windsurfParser,
  discovery: windsurfDiscovery,
  pricing: windsurfPricing,
  tools: windsurfTools,
  hooks: windsurfHooks,

  getContextLimit(model: string): number {
    if (model.includes('claude') && model.includes('opus')) return 1_000_000
    if (model.includes('claude')) return 200_000
    if (model.includes('gpt-4o')) return 128_000
    if (model.includes('gemini')) return 1_000_000
    return 200_000
  },
}
