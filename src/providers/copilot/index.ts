/**
 * GitHub Copilot provider (Tier 3 — limited monitoring).
 *
 * Copilot stores sessions in VS Code's workspaceStorage SQLite.
 * No hooks available. Subscription-based pricing (not per-token).
 */
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { Provider, SessionParser, SessionDiscovery, PricingResolver, ToolNameMapper, CanonicalTool, SessionContext } from '../types.js'
import type { PricingConfig, SessionRecord, TurnMetrics } from '../../types.js'

// Copilot is subscription-based — these are approximate per-token costs for tracking
const COPILOT_MODELS: Record<string, PricingConfig> = {
  'gpt-4o': { model: 'gpt-4o', inputPerMillion: 2.5, outputPerMillion: 10.0, cacheCreationPerMillion: 3.125, cacheReadPerMillion: 1.25 },
  'claude-sonnet': { model: 'claude-sonnet', inputPerMillion: 3.0, outputPerMillion: 15.0, cacheCreationPerMillion: 3.75, cacheReadPerMillion: 0.3 },
  'copilot-default': { model: 'copilot-default', inputPerMillion: 0, outputPerMillion: 0, cacheCreationPerMillion: 0, cacheReadPerMillion: 0 },
}

const pricing: PricingResolver = {
  models: COPILOT_MODELS,
  defaultPricing: COPILOT_MODELS['copilot-default'],
  getPricing(modelId: string): PricingConfig {
    for (const [key, p] of Object.entries(COPILOT_MODELS)) { if (modelId.startsWith(key)) return p }
    return this.defaultPricing
  },
}

const tools: ToolNameMapper = {
  toCanonical(name: string): CanonicalTool {
    const map: Record<string, CanonicalTool> = { read_file: 'file_read', run_terminal_command: 'bash_execute', edit_file: 'file_edit', workspace_search: 'file_search', get_diagnostics: 'other' }
    return map[name] ?? 'other'
  },
  fromCanonical(c: CanonicalTool): string { return c === 'bash_execute' ? 'run_terminal_command' : 'read_file' },
  extractInputLabel(): string { return '' },
}

const parser: SessionParser = {
  parseLine(line: string): SessionRecord | null { try { return JSON.parse(line.trim()) } catch { return null } },
  async parseFile(filePath: string): Promise<SessionRecord[]> {
    // Would need better-sqlite3 to read state.vscdb — return empty for now
    return []
  },
  extractTurns(): TurnMetrics[] { return [] },
  extractModel(): string | null { return null },
  extractContext(): SessionContext { return { cwd: null, gitBranch: null, projectName: null, firstUserMessage: null } },
  hasResumeBoundary(): boolean { return false },
}

const discovery: SessionDiscovery = {
  fileExtensions: ['.vscdb'],
  watchDepth: 2,
  extractSessionId(fp: string): string { return basename(fp).replace('.vscdb', '') },
  extractProjectPath(): string { return 'copilot' },
}

function getCopilotDataDir(): string {
  if (process.platform === 'darwin') return resolve(homedir(), 'Library/Application Support/Code/User/workspaceStorage')
  if (process.platform === 'win32') return resolve(process.env.APPDATA || homedir(), 'Code/User/workspaceStorage')
  return resolve(homedir(), '.config/Code/User/workspaceStorage')
}

export const copilotProvider: Provider = {
  name: 'copilot',
  displayName: 'GitHub Copilot',
  tier: 3,
  directories: {
    sessionsDir: getCopilotDataDir,
    configDir: () => resolve(homedir(), '.config/github-copilot'),
    stateDir: () => resolve(homedir(), '.clauditor'),
  },
  parser, discovery, pricing, tools,
  hooks: null,
  getContextLimit(): number { return 128_000 },
}
