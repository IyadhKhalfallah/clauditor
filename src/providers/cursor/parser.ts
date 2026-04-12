/**
 * Cursor session parser.
 *
 * Cursor stores conversations in SQLite (state.vscdb) with:
 * - composerData:<id> → session metadata
 * - bubbleId:<composerId>:<bubbleId> → individual messages
 *
 * For now, this parser handles exported JSONL or direct SQLite reading
 * via optional better-sqlite3 dependency.
 */
import { readFile } from 'node:fs/promises'
import type { SessionRecord, AssistantRecord, UserRecord, TurnMetrics, TokenUsage, ToolCallSummary } from '../../types.js'
import type { SessionParser, SessionContext } from '../types.js'

/**
 * Try to read Cursor's state.vscdb SQLite database.
 * Returns null if better-sqlite3 is not available.
 */
async function tryReadSqlite(filePath: string): Promise<SessionRecord[] | null> {
  try {
    // Dynamic import — better-sqlite3 is optional
    const Database = (await import('better-sqlite3')).default
    const db = new Database(filePath, { readonly: true })

    const records: SessionRecord[] = []
    const rows = db.prepare(
      `SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' ORDER BY key`
    ).all() as Array<{ key: string; value: string }>

    for (const row of rows) {
      try {
        const data = JSON.parse(row.value)
        if (!data.composerId) continue

        // Create a session marker
        records.push({
          type: 'user',
          sessionId: data.composerId,
          timestamp: new Date(data.createdAt || 0).toISOString(),
          message: { role: 'user', content: '' },
        } as UserRecord)

        // Extract usage data if available
        if (data.usageData) {
          for (const [model, usage] of Object.entries(data.usageData)) {
            const u = usage as Record<string, unknown>
            records.push({
              type: 'assistant',
              sessionId: data.composerId,
              timestamp: new Date(data.lastUpdatedAt || 0).toISOString(),
              message: {
                role: 'assistant',
                model,
                content: [],
                usage: {
                  input_tokens: (u.inputTokens as number) || 0,
                  output_tokens: (u.outputTokens as number) || 0,
                  cache_creation_input_tokens: 0,
                  cache_read_input_tokens: 0,
                },
              },
            } as AssistantRecord)
          }
        }
      } catch {
        continue
      }
    }

    db.close()
    return records
  } catch {
    // better-sqlite3 not available or file not accessible
    return null
  }
}

export const cursorParser: SessionParser = {
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
    // Try SQLite first for .vscdb files
    if (filePath.endsWith('.vscdb')) {
      const records = await tryReadSqlite(filePath)
      if (records) return records
    }

    // Fall back to JSONL
    const content = await readFile(filePath, 'utf-8')
    const records: SessionRecord[] = []
    for (const line of content.split('\n')) {
      const record = cursorParser.parseLine(line)
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
    return { cwd: null, gitBranch: null, projectName: null, firstUserMessage: null }
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
