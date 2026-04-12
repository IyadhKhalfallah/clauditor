/**
 * Gemini CLI provider (Tier 2 — session monitoring only, no hooks).
 */
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { Provider, SessionParser, SessionDiscovery, PricingResolver, ToolNameMapper, CanonicalTool, SessionContext } from '../types.js'
import type { PricingConfig, SessionRecord, AssistantRecord, UserRecord, TurnMetrics, TokenUsage, ToolCallSummary, ContentBlock } from '../../types.js'

// Pricing
const GEMINI_MODELS: Record<string, PricingConfig> = {
  'gemini-2.5-pro': { model: 'gemini-2.5-pro', inputPerMillion: 1.25, outputPerMillion: 10.0, cacheCreationPerMillion: 1.5625, cacheReadPerMillion: 0.3125 },
  'gemini-2.5-flash': { model: 'gemini-2.5-flash', inputPerMillion: 0.15, outputPerMillion: 0.6, cacheCreationPerMillion: 0.1875, cacheReadPerMillion: 0.0375 },
  'gemini-2.0-flash': { model: 'gemini-2.0-flash', inputPerMillion: 0.1, outputPerMillion: 0.4, cacheCreationPerMillion: 0.125, cacheReadPerMillion: 0.025 },
}

const pricing: PricingResolver = {
  models: GEMINI_MODELS,
  defaultPricing: GEMINI_MODELS['gemini-2.5-flash'],
  getPricing(modelId: string): PricingConfig {
    for (const [key, p] of Object.entries(GEMINI_MODELS)) {
      if (modelId.startsWith(key)) return p
    }
    return this.defaultPricing
  },
}

// Tools
const TOOL_MAP: Record<string, CanonicalTool> = {
  ReadFile: 'file_read', ReadManyFiles: 'file_read', WriteFile: 'file_write',
  EditFile: 'file_edit', ListDirectory: 'file_read', SearchFiles: 'file_search',
  ExecuteCommand: 'bash_execute', WebSearch: 'web_search', WebFetch: 'web_fetch',
  GlobTool: 'file_search', GrepTool: 'file_search',
}

const tools: ToolNameMapper = {
  toCanonical(name: string): CanonicalTool { return TOOL_MAP[name] ?? 'other' },
  fromCanonical(c: CanonicalTool): string {
    const rev: Record<CanonicalTool, string> = { bash_execute: 'ExecuteCommand', file_read: 'ReadFile', file_write: 'WriteFile', file_edit: 'EditFile', file_search: 'SearchFiles', web_search: 'WebSearch', web_fetch: 'WebFetch', browser: 'WebFetch', mcp_tool: 'ExecuteCommand', other: 'ExecuteCommand' }
    return rev[c] ?? 'ExecuteCommand'
  },
  extractInputLabel(toolName: string, input: unknown): string {
    if (!input || typeof input !== 'object') return ''
    const obj = input as Record<string, unknown>
    if (toolName === 'ExecuteCommand') return (typeof obj.command === 'string' ? obj.command : '').split('\n')[0].slice(0, 60)
    if (['ReadFile', 'WriteFile', 'EditFile'].includes(toolName)) return (typeof obj.path === 'string' ? obj.path : '').split(/[/\\]/).pop() || ''
    return ''
  },
}

// Parser
const parser: SessionParser = {
  parseLine(line: string): SessionRecord | null {
    try { return JSON.parse(line.trim()) } catch { return null }
  },

  async parseFile(filePath: string): Promise<SessionRecord[]> {
    const content = await readFile(filePath, 'utf-8')
    const records: SessionRecord[] = []
    try {
      const session = JSON.parse(content)
      const messages = session.messages || session.history || (Array.isArray(session) ? session : [])
      for (const msg of messages) {
        const ts = msg.timestamp || msg.createTime || new Date().toISOString()
        if (msg.role === 'user') {
          const text = typeof msg.parts?.[0]?.text === 'string' ? msg.parts[0].text : typeof msg.content === 'string' ? msg.content : ''
          records.push({ type: 'user', sessionId: '', timestamp: ts, message: { role: 'user', content: text } } as UserRecord)
        } else if (msg.role === 'model' || msg.role === 'assistant') {
          const blocks: ContentBlock[] = []
          if (msg.parts) {
            for (const part of msg.parts) {
              if (part.text) blocks.push({ type: 'text', text: part.text })
              if (part.functionCall) blocks.push({ type: 'tool_use', name: part.functionCall.name, input: part.functionCall.args })
            }
          }
          const usage = msg.usageMetadata ? {
            input_tokens: msg.usageMetadata.promptTokenCount || 0,
            output_tokens: msg.usageMetadata.candidatesTokenCount || 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: msg.usageMetadata.cachedContentTokenCount || 0,
          } : undefined
          records.push({ type: 'assistant', sessionId: '', timestamp: ts, message: { role: 'assistant', model: msg.modelVersion || '', content: blocks, usage } } as AssistantRecord)
        }
      }
    } catch {
      for (const line of content.split('\n')) {
        const r = parser.parseLine(line)
        if (r) records.push(r)
      }
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
      const total = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens
      turns.push({ turnIndex: idx++, timestamp: a.timestamp, usage: u, cacheRatio: total > 0 ? u.cache_read_input_tokens / total : 0, toolCalls: (a.message.content || []).filter(b => b.type === 'tool_use').map(b => ({ name: b.name || 'unknown', inputHash: '', outputHash: '' })) })
    }
    return turns
  },
  extractModel(records: SessionRecord[]): string | null {
    for (let i = records.length - 1; i >= 0; i--) { if (records[i].type === 'assistant') { const m = (records[i] as AssistantRecord).message?.model; if (m) return m } }
    return null
  },
  extractContext(records: SessionRecord[]): SessionContext { return { cwd: null, gitBranch: null, projectName: null, firstUserMessage: null } },
  hasResumeBoundary(): boolean { return false },
}

// Discovery
const discovery: SessionDiscovery = {
  fileExtensions: ['.json'],
  watchDepth: 2,
  extractSessionId(fp: string): string { return basename(fp).replace('.json', '') },
  extractProjectPath(): string { return 'gemini' },
}

export const geminiProvider: Provider = {
  name: 'gemini',
  displayName: 'Gemini CLI',
  tier: 2,
  directories: {
    sessionsDir: () => resolve(homedir(), '.gemini/history'),
    configDir: () => resolve(homedir(), '.gemini'),
    stateDir: () => resolve(homedir(), '.clauditor'),
  },
  parser, discovery, pricing, tools,
  hooks: null,
  getContextLimit(model: string): number {
    if (model.includes('pro')) return 1_000_000
    return 1_000_000 // Gemini models generally have large contexts
  },
}
