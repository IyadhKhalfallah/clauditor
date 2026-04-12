/**
 * Cline (and Roo Code) VS Code extension provider.
 *
 * Cline stores tasks as JSON in VS Code globalStorage with:
 * - api_conversation_history.json (Anthropic MessageParam format)
 * - 9 hook events via .clinerules/hooks/ scripts
 * - Rich tool set (execute_command, read_file, write_to_file, etc.)
 */
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import type { Provider } from '../types.js'
import { clineParser } from './parser.js'
import { clineDiscovery } from './discovery.js'
import { clinePricing } from './pricing.js'
import { clineTools } from './tools.js'
import { clineHooks } from './hooks.js'

function getClineStorageDir(): string {
  if (process.platform === 'darwin') {
    return resolve(homedir(), 'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev')
  }
  if (process.platform === 'win32') {
    return resolve(process.env.APPDATA || homedir(), 'Code/User/globalStorage/saoudrizwan.claude-dev')
  }
  return resolve(homedir(), '.vscode/extensions/globalStorage/saoudrizwan.claude-dev')
}

export const clineProvider: Provider = {
  name: 'cline',
  displayName: 'Cline',
  tier: 1,

  directories: {
    sessionsDir: () => resolve(getClineStorageDir(), 'tasks'),
    configDir: () => getClineStorageDir(),
    stateDir: () => resolve(homedir(), '.clauditor'),
  },

  parser: clineParser,
  discovery: clineDiscovery,
  pricing: clinePricing,
  tools: clineTools,
  hooks: clineHooks,

  getContextLimit(model: string): number {
    if (model.includes('opus')) return 1_000_000
    if (model.includes('claude')) return 200_000
    if (model.includes('gpt-4o')) return 128_000
    if (model.includes('gemini')) return 1_000_000
    if (model.includes('deepseek')) return 128_000
    return 200_000
  },
}
