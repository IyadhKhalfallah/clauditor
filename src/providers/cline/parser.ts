/**
 * Cline/Roo Code session parser.
 *
 * Cline stores conversations as api_conversation_history.json in VS Code
 * globalStorage. The format is an array of Anthropic MessageParam objects.
 */
import { readFile } from 'node:fs/promises'
import type { SessionRecord, AssistantRecord, UserRecord, TurnMetrics, TokenUsage, ToolCallSummary, ContentBlock } from '../../types.js'
import type { SessionParser, SessionContext } from '../types.js'

export const clineParser: SessionParser = {
  parseLine(line: string): SessionRecord | null {
    const trimmed = line.trim()
    if (!trimmed) return null
    try {
      return JSON.parse(trimmed)
    } catch {
      return null
    }
  },

  async parseFile(filePath: string): Promise<SessionRecord[]> {
    const content = await readFile(filePath, 'utf-8')
    const records: SessionRecord[] = []

    try {
      const messages = JSON.parse(content)
      if (!Array.isArray(messages)) return records

      for (const msg of messages) {
        if (!msg.role) continue
        const timestamp = msg.ts ? new Date(msg.ts).toISOString() : new Date().toISOString()

        if (msg.role === 'user') {
          records.push({
            type: 'user',
            sessionId: '',
            timestamp,
            message: { role: 'user', content: msg.content || '' },
          } as UserRecord)
        } else if (msg.role === 'assistant') {
          const contentBlocks: ContentBlock[] = []
          if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block.type === 'text') {
                contentBlocks.push({ type: 'text', text: block.text || '' })
              } else if (block.type === 'tool_use') {
                contentBlocks.push({
                  type: 'tool_use',
                  name: block.name || 'unknown',
                  id: block.id || '',
                  input: block.input,
                })
              }
            }
          } else if (typeof msg.content === 'string') {
            contentBlocks.push({ type: 'text', text: msg.content })
          }

          records.push({
            type: 'assistant',
            sessionId: '',
            timestamp,
            message: {
              role: 'assistant',
              model: msg.model || '',
              content: contentBlocks,
              usage: msg.usage ? {
                input_tokens: msg.usage.input_tokens || 0,
                output_tokens: msg.usage.output_tokens || 0,
                cache_creation_input_tokens: msg.usage.cache_creation_input_tokens || 0,
                cache_read_input_tokens: msg.usage.cache_read_input_tokens || 0,
              } : undefined,
            },
          } as AssistantRecord)
        }
      }
    } catch {
      // Not valid JSON array — might be JSONL
      for (const line of content.split('\n')) {
        const record = clineParser.parseLine(line)
        if (record) records.push(record)
      }
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
    return { cwd: null, gitBranch: null, projectName: null, firstUserMessage: null }
  },

  hasResumeBoundary(records: SessionRecord[]): boolean {
    return false // Cline doesn't have compaction boundaries
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
