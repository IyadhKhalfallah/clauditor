/**
 * Zed AI provider (Tier 3 — limited monitoring).
 *
 * Zed stores conversations in its internal SQLite database.
 * Extensions are WASM-based (no shell hook support).
 */
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import type { Provider, SessionParser, SessionDiscovery, PricingResolver, ToolNameMapper, CanonicalTool, SessionContext } from '../types.js'
import type { PricingConfig, SessionRecord, TurnMetrics } from '../../types.js'

const ZED_MODELS: Record<string, PricingConfig> = {
  'claude-sonnet-4-6': { model: 'claude-sonnet-4-6', inputPerMillion: 3.0, outputPerMillion: 15.0, cacheCreationPerMillion: 3.75, cacheReadPerMillion: 0.3 },
  'gpt-4o': { model: 'gpt-4o', inputPerMillion: 2.5, outputPerMillion: 10.0, cacheCreationPerMillion: 3.125, cacheReadPerMillion: 1.25 },
}

const pricing: PricingResolver = {
  models: ZED_MODELS,
  defaultPricing: ZED_MODELS['claude-sonnet-4-6'],
  getPricing(modelId: string): PricingConfig {
    for (const [key, p] of Object.entries(ZED_MODELS)) { if (modelId.startsWith(key)) return p }
    return this.defaultPricing
  },
}

const tools: ToolNameMapper = {
  toCanonical(name: string): CanonicalTool {
    const map: Record<string, CanonicalTool> = { read_file: 'file_read', edit_file: 'file_edit', create_file: 'file_write', run_terminal_command: 'bash_execute', search_files: 'file_search', list_directory: 'file_read', diagnostics: 'other' }
    return map[name] ?? 'other'
  },
  fromCanonical(c: CanonicalTool): string { return c === 'bash_execute' ? 'run_terminal_command' : 'read_file' },
  extractInputLabel(): string { return '' },
}

const parser: SessionParser = {
  parseLine(): SessionRecord | null { return null },
  async parseFile(): Promise<SessionRecord[]> { return [] },
  extractTurns(): TurnMetrics[] { return [] },
  extractModel(): string | null { return null },
  extractContext(): SessionContext { return { cwd: null, gitBranch: null, projectName: null, firstUserMessage: null } },
  hasResumeBoundary(): boolean { return false },
}

const discovery: SessionDiscovery = {
  fileExtensions: ['.db'],
  watchDepth: 1,
  extractSessionId(fp: string): string { return basename(fp) },
  extractProjectPath(): string { return 'zed' },
}

function getZedDataDir(): string {
  if (process.platform === 'darwin') return resolve(homedir(), 'Library/Application Support/Zed')
  return resolve(homedir(), '.local/share/zed')
}

export const zedProvider: Provider = {
  name: 'zed',
  displayName: 'Zed AI',
  tier: 3,
  directories: {
    sessionsDir: () => resolve(getZedDataDir(), 'db'),
    configDir: () => resolve(homedir(), '.config/zed'),
    stateDir: () => resolve(homedir(), '.clauditor'),
  },
  parser, discovery, pricing, tools,
  hooks: null,
  getContextLimit(): number { return 200_000 },
}
