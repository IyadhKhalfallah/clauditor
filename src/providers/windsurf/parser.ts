/**
 * Windsurf (Cascade) session parser.
 *
 * Windsurf stores transcripts as JSONL at ~/.windsurf/transcripts/{trajectory_id}.jsonl
 * Each line has: { status, type, [type_name]: { ... } }
 * Types: user_input, planner_response, code_action
 */
import { readFile } from 'node:fs/promises'
import type { SessionRecord, AssistantRecord, UserRecord, TurnMetrics, TokenUsage, ToolCallSummary } from '../../types.js'
import type { SessionParser, SessionContext } from '../types.js'

function parseWindsurfLine(line: string): SessionRecord | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed.type) return null

    const timestamp = parsed.timestamp || new Date().toISOString()

    switch (parsed.type) {
      case 'user_input': {
        const input = parsed.user_input || {}
        return {
          type: 'user',
          sessionId: '',
          timestamp,
          message: {
            role: 'user' as const,
            content: input.text || input.message || '',
          },
          cwd: input.cwd || undefined,
        } as UserRecord
      }

      case 'planner_response': {
        const response = parsed.planner_response || {}
        return {
          type: 'assistant',
          sessionId: '',
          timestamp,
          message: {
            role: 'assistant' as const,
            model: response.model || '',
            content: response.text ? [{ type: 'text' as const, text: response.text }] : [],
            usage: response.usage ? {
              input_tokens: response.usage.input_tokens || 0,
              output_tokens: response.usage.output_tokens || 0,
              cache_creation_input_tokens: response.usage.cache_creation_input_tokens || 0,
              cache_read_input_tokens: response.usage.cache_read_input_tokens || 0,
            } : undefined,
          },
        } as AssistantRecord
      }

      case 'code_action': {
        const action = parsed.code_action || {}
        const toolName = action.tool_name || action.action_type || 'unknown'
        return {
          type: 'assistant',
          sessionId: '',
          timestamp,
          message: {
            role: 'assistant' as const,
            model: '',
            content: [{
              type: 'tool_use' as const,
              name: toolName,
              input: action.parameters || action.input || {},
            }],
          },
        } as AssistantRecord
      }

      default:
        return { type: parsed.type, sessionId: '', timestamp }
    }
  } catch {
    return null
  }
}

export const windsurfParser: SessionParser = {
  parseLine: parseWindsurfLine,

  async parseFile(filePath: string): Promise<SessionRecord[]> {
    const content = await readFile(filePath, 'utf-8')
    const records: SessionRecord[] = []
    for (const line of content.split('\n')) {
      const record = parseWindsurfLine(line)
      if (record) records.push(record)
    }
    return records
  },

  extractTurns(records: SessionRecord[]): TurnMetrics[] {
    const turns: TurnMetrics[] = []
    let turnIndex = 0

    for (const record of records) {
      if (record.type !== 'assistant') continue
      const assistant = record as AssistantRecord
      if (!assistant.message?.usage) continue

      const usage = normalizeUsage(assistant.message.usage)
      const totalInput = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
      const cacheRatio = totalInput > 0 ? usage.cache_read_input_tokens / totalInput : 0

      const toolCalls: ToolCallSummary[] = (assistant.message.content || [])
        .filter(block => block.type === 'tool_use')
        .map(block => ({
          name: block.name || 'unknown',
          inputHash: '',
          outputHash: '',
        }))

      turns.push({ turnIndex: turnIndex++, timestamp: assistant.timestamp, usage, cacheRatio, toolCalls })
    }

    return turns
  },

  extractModel(records: SessionRecord[]): string | null {
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i]
      if (r.type === 'assistant') {
        const model = (r as AssistantRecord).message?.model
        if (model) return model
      }
    }
    return null
  },

  extractContext(records: SessionRecord[]): SessionContext {
    let cwd: string | null = null
    let firstUserMessage: string | null = null

    for (const record of records) {
      if (record.type === 'user') {
        const user = record as UserRecord
        if (!cwd && user.cwd) cwd = user.cwd
        if (!firstUserMessage) {
          const content = user.message?.content
          if (typeof content === 'string' && content.trim()) {
            firstUserMessage = content.trim()
          }
        }
      }
    }

    const projectName = cwd ? cwd.split(/[/\\]/).filter(Boolean).pop() ?? null : null
    return { cwd, gitBranch: null, projectName, firstUserMessage }
  },

  hasResumeBoundary(records: SessionRecord[]): boolean {
    return records.some(r => r.type === 'compact_boundary')
  },
}

function normalizeUsage(usage: Partial<TokenUsage>): TokenUsage {
  return {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
  }
}
