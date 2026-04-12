/**
 * Amazon Q Developer provider (Tier 3 — limited monitoring).
 *
 * Amazon Q stores sessions in ~/.aws/amazonq/.
 * No user-level hook system — it's a managed service.
 */
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import type { Provider, SessionParser, SessionDiscovery, PricingResolver, ToolNameMapper, CanonicalTool, SessionContext } from '../types.js'
import type { PricingConfig, SessionRecord, TurnMetrics } from '../../types.js'

// Amazon Q is subscription-based
const AQ_MODELS: Record<string, PricingConfig> = {
  'amazonq-default': { model: 'amazonq-default', inputPerMillion: 0, outputPerMillion: 0, cacheCreationPerMillion: 0, cacheReadPerMillion: 0 },
}

const pricing: PricingResolver = {
  models: AQ_MODELS,
  defaultPricing: AQ_MODELS['amazonq-default'],
  getPricing(): PricingConfig { return this.defaultPricing },
}

const tools: ToolNameMapper = {
  toCanonical(name: string): CanonicalTool {
    const map: Record<string, CanonicalTool> = { fs_read: 'file_read', fs_write: 'file_write', execute_bash: 'bash_execute', use_aws: 'other' }
    return map[name] ?? 'other'
  },
  fromCanonical(c: CanonicalTool): string { return c === 'bash_execute' ? 'execute_bash' : 'fs_read' },
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
  fileExtensions: ['.json'],
  watchDepth: 2,
  extractSessionId(fp: string): string { return basename(fp).replace('.json', '') },
  extractProjectPath(): string { return 'amazonq' },
}

export const amazonqProvider: Provider = {
  name: 'amazonq',
  displayName: 'Amazon Q Developer',
  tier: 3,
  directories: {
    sessionsDir: () => resolve(homedir(), '.aws/amazonq'),
    configDir: () => resolve(homedir(), '.aws/amazonq'),
    stateDir: () => resolve(homedir(), '.clauditor'),
  },
  parser, discovery, pricing, tools,
  hooks: null,
  getContextLimit(): number { return 128_000 },
}
