/**
 * Aider provider (Tier 2 — session monitoring only, no hooks).
 *
 * Aider stores chat history as Markdown (.aider.chat.history.md)
 * and reports token/cost inline in output.
 */
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { Provider, SessionParser, SessionDiscovery, PricingResolver, ToolNameMapper, CanonicalTool, SessionContext } from '../types.js'
import type { PricingConfig, SessionRecord, AssistantRecord, UserRecord, TurnMetrics, TokenUsage, ToolCallSummary } from '../../types.js'

// Aider uses litellm and supports 100+ models — these are common defaults
const AIDER_MODELS: Record<string, PricingConfig> = {
  'claude-sonnet-4-6': { model: 'claude-sonnet-4-6', inputPerMillion: 3.0, outputPerMillion: 15.0, cacheCreationPerMillion: 3.75, cacheReadPerMillion: 0.3 },
  'claude-opus-4-6': { model: 'claude-opus-4-6', inputPerMillion: 15.0, outputPerMillion: 75.0, cacheCreationPerMillion: 18.75, cacheReadPerMillion: 1.5 },
  'gpt-4o': { model: 'gpt-4o', inputPerMillion: 2.5, outputPerMillion: 10.0, cacheCreationPerMillion: 3.125, cacheReadPerMillion: 1.25 },
  'deepseek-chat': { model: 'deepseek-chat', inputPerMillion: 0.27, outputPerMillion: 1.10, cacheCreationPerMillion: 0.27, cacheReadPerMillion: 0.07 },
}

const pricing: PricingResolver = {
  models: AIDER_MODELS,
  defaultPricing: AIDER_MODELS['claude-sonnet-4-6'],
  getPricing(modelId: string): PricingConfig {
    for (const [key, p] of Object.entries(AIDER_MODELS)) { if (modelId.startsWith(key)) return p }
    return this.defaultPricing
  },
}

const tools: ToolNameMapper = {
  toCanonical(name: string): CanonicalTool {
    if (name === '/run' || name === 'bash') return 'bash_execute'
    if (name === '/add' || name === 'edit') return 'file_edit'
    return 'other'
  },
  fromCanonical(c: CanonicalTool): string { return c === 'bash_execute' ? '/run' : '/add' },
  extractInputLabel(_t: string, input: unknown): string {
    return typeof input === 'string' ? input.slice(0, 60) : ''
  },
}

/**
 * Parse Aider's markdown chat history.
 * Format:
 *   # aider chat started at 2025-05-07 17:24:21
 *   > user message (blockquoted)
 *   assistant response (plain text)
 *   Tokens: 4.2k sent, 1.1k received. Cost: $0.03 message, $0.15 session.
 */
const parser: SessionParser = {
  parseLine(line: string): SessionRecord | null { return null },

  async parseFile(filePath: string): Promise<SessionRecord[]> {
    const content = await readFile(filePath, 'utf-8')
    const records: SessionRecord[] = []
    const lines = content.split('\n')
    let currentRole: 'user' | 'assistant' | null = null
    let currentText = ''
    let sessionTimestamp = new Date().toISOString()

    for (const line of lines) {
      // Session header
      const headerMatch = line.match(/^# aider chat started at (.+)/)
      if (headerMatch) {
        sessionTimestamp = new Date(headerMatch[1]).toISOString()
        continue
      }

      // Token/cost line
      const tokenMatch = line.match(/Tokens:\s*([\d.]+)k sent.*?([\d.]+)k received.*?Cost:\s*\$([\d.]+)/)
      if (tokenMatch) {
        const sent = Math.round(parseFloat(tokenMatch[1]) * 1000)
        const received = Math.round(parseFloat(tokenMatch[2]) * 1000)
        records.push({
          type: 'assistant', sessionId: '', timestamp: sessionTimestamp,
          message: { role: 'assistant', model: '', content: [], usage: { input_tokens: sent, output_tokens: received, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
        } as AssistantRecord)
        continue
      }

      // User message (blockquoted)
      if (line.startsWith('> ')) {
        if (currentRole === 'assistant' && currentText.trim()) {
          records.push({ type: 'assistant', sessionId: '', timestamp: sessionTimestamp, message: { role: 'assistant', model: '', content: [{ type: 'text', text: currentText.trim() }] } } as AssistantRecord)
        }
        currentRole = 'user'
        currentText = line.slice(2) + '\n'
        continue
      }

      // Transition from user to assistant
      if (currentRole === 'user' && !line.startsWith('> ') && line.trim()) {
        records.push({ type: 'user', sessionId: '', timestamp: sessionTimestamp, message: { role: 'user', content: currentText.trim() } } as UserRecord)
        currentRole = 'assistant'
        currentText = line + '\n'
        continue
      }

      if (currentRole) currentText += line + '\n'
    }

    // Flush remaining
    if (currentRole === 'assistant' && currentText.trim()) {
      records.push({ type: 'assistant', sessionId: '', timestamp: sessionTimestamp, message: { role: 'assistant', model: '', content: [{ type: 'text', text: currentText.trim() }] } } as AssistantRecord)
    } else if (currentRole === 'user' && currentText.trim()) {
      records.push({ type: 'user', sessionId: '', timestamp: sessionTimestamp, message: { role: 'user', content: currentText.trim() } } as UserRecord)
    }

    return records
  },

  extractTurns(records: SessionRecord[]): TurnMetrics[] {
    const turns: TurnMetrics[] = []
    let idx = 0
    for (const r of records) {
      if (r.type !== 'assistant') continue
      const a = r as AssistantRecord
      if (!a.message?.usage) continue
      const u = a.message.usage
      turns.push({ turnIndex: idx++, timestamp: a.timestamp, usage: u, cacheRatio: 0, toolCalls: [] })
    }
    return turns
  },
  extractModel(): string | null { return null },
  extractContext(): SessionContext { return { cwd: null, gitBranch: null, projectName: null, firstUserMessage: null } },
  hasResumeBoundary(): boolean { return false },
}

const discovery: SessionDiscovery = {
  fileExtensions: ['.md'],
  watchDepth: 1,
  extractSessionId(fp: string): string { return basename(fp).replace('.md', '') },
  extractProjectPath(): string { return 'aider' },
}

export const aiderProvider: Provider = {
  name: 'aider',
  displayName: 'Aider',
  tier: 2,
  directories: {
    sessionsDir: () => process.cwd(), // Aider stores .aider.chat.history.md in project root
    configDir: () => resolve(homedir(), '.aider'),
    stateDir: () => resolve(homedir(), '.clauditor'),
  },
  parser, discovery, pricing, tools,
  hooks: null,
  getContextLimit(model: string): number {
    if (model.includes('opus')) return 1_000_000
    if (model.includes('claude')) return 200_000
    if (model.includes('gpt-4o')) return 128_000
    return 128_000
  },
}
