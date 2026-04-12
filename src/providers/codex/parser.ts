/**
 * Codex CLI session parser.
 *
 * Codex stores sessions as JSONL where each line is a RolloutLine:
 *   { timestamp: string, item: RolloutItem }
 *
 * RolloutItem is a tagged union:
 *   - SessionMeta: first line with session metadata
 *   - ResponseItem: model response items (messages, tool calls, outputs)
 *   - Compacted: compacted history
 *   - EventMsg: agent events (TokenCount, ExecCommandBegin/End, etc.)
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { SessionRecord, AssistantRecord, UserRecord, TurnMetrics, TokenUsage, ToolCallSummary } from '../../types.js'
import type { SessionParser, SessionContext } from '../types.js'

// Codex-specific record types
interface RolloutLine {
  timestamp: string
  item: Record<string, unknown>
}

function parseCodexLine(line: string): SessionRecord | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  try {
    const rollout = JSON.parse(trimmed) as RolloutLine
    if (!rollout.item) return null

    const item = rollout.item

    // SessionMeta — first line
    if ('id' in item && 'cwd' in item && 'cli_version' in item) {
      return {
        type: 'user',
        sessionId: item.id as string || '',
        timestamp: rollout.timestamp,
        message: { role: 'user' as const, content: '' },
        cwd: item.cwd as string || undefined,
        version: item.cli_version as string || undefined,
      } as UserRecord
    }

    // Compacted — compaction boundary
    if ('Compacted' in item || item.type === 'Compacted') {
      return { type: 'compact_boundary' }
    }

    // EventMsg with token counts
    if (item.type === 'EventMsg' || item.event_type === 'TokenCount') {
      const event = (item.event || item) as Record<string, unknown>
      if (event.type === 'TokenCount' || event.TokenCount) {
        const tc = (event.TokenCount || event) as Record<string, unknown>
        return {
          type: 'assistant',
          sessionId: '',
          timestamp: rollout.timestamp,
          message: {
            role: 'assistant' as const,
            model: (tc.model as string) || '',
            content: [],
            usage: {
              input_tokens: (tc.input_tokens as number) || 0,
              output_tokens: (tc.output_tokens as number) || 0,
              cache_creation_input_tokens: (tc.input_tokens_cache_write as number) || 0,
              cache_read_input_tokens: (tc.input_tokens_cache_read as number) || 0,
            },
          },
        } as AssistantRecord
      }
    }

    // ResponseItem with tool calls
    if (item.type === 'ResponseItem') {
      const resp = (item.response_item || item) as Record<string, unknown>
      if (resp.type === 'function_call') {
        return {
          type: 'assistant',
          sessionId: '',
          timestamp: rollout.timestamp,
          message: {
            role: 'assistant' as const,
            model: '',
            content: [{
              type: 'tool_use' as const,
              name: resp.name as string || 'unknown',
              id: resp.call_id as string || resp.id as string || '',
              input: tryParseJson(resp.arguments as string),
            }],
          },
        } as AssistantRecord
      }
      if (resp.type === 'message' && resp.role === 'assistant') {
        const content = resp.content as Array<Record<string, unknown>> | undefined
        const text = content?.map(c => c.text || '').join('') || ''
        return {
          type: 'assistant',
          sessionId: '',
          timestamp: rollout.timestamp,
          message: {
            role: 'assistant' as const,
            model: '',
            content: text ? [{ type: 'text' as const, text }] : [],
          },
        } as AssistantRecord
      }
      if (resp.type === 'message' && resp.role === 'user') {
        const content = resp.content as Array<Record<string, unknown>> | string | undefined
        const text = typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content.map(c => c.text || '').join('')
            : ''
        return {
          type: 'user',
          sessionId: '',
          timestamp: rollout.timestamp,
          message: { role: 'user' as const, content: text },
        } as UserRecord
      }
    }

    // Generic event — keep as generic record
    return {
      type: 'generic',
      sessionId: '',
      timestamp: rollout.timestamp,
    }
  } catch {
    return null
  }
}

function tryParseJson(str: unknown): unknown {
  if (typeof str !== 'string') return str
  try { return JSON.parse(str) } catch { return str }
}

export const codexParser: SessionParser = {
  parseLine: parseCodexLine,

  async parseFile(filePath: string): Promise<SessionRecord[]> {
    const content = await readFile(filePath, 'utf-8')
    const records: SessionRecord[] = []
    for (const line of content.split('\n')) {
      const record = parseCodexLine(line)
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
          inputHash: hashValue(block.input),
          outputHash: '',
          inputLabel: codexParser.extractTurns.name, // placeholder
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
    let gitBranch: string | null = null
    let firstUserMessage: string | null = null

    for (const record of records) {
      if (record.type === 'user') {
        const user = record as UserRecord
        if (!cwd && user.cwd) cwd = user.cwd
        if (!gitBranch && user.gitBranch) gitBranch = user.gitBranch
        if (!firstUserMessage) {
          const content = user.message?.content
          if (typeof content === 'string' && content.trim()) {
            firstUserMessage = content.trim()
          }
        }
      }
    }

    const projectName = cwd ? cwd.split(/[/\\]/).filter(Boolean).pop() ?? null : null
    return { cwd, gitBranch, projectName, firstUserMessage }
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

function hashValue(value: unknown): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return createHash('sha256').update(str).digest('hex').slice(0, 16)
}
