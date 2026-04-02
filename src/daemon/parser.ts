import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type {
  SessionRecord,
  UserRecord,
  AssistantRecord,
  TokenUsage,
  TurnMetrics,
  ToolCallSummary,
} from '../types.js'

/**
 * Parse a single JSONL line into a typed record.
 * Returns null for unparseable or irrelevant lines.
 *
 * Real Claude Code JSONL files contain these record types:
 * - user, assistant: conversation messages
 * - system: system-level records
 * - queue-operation: internal queue ops
 * - attachment: file attachments
 * - summary, compact_boundary: compaction markers
 *
 * Tool results are embedded inside user messages as content blocks,
 * not as top-level records.
 */
export function parseJsonlLine(line: string): SessionRecord | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed.type) return null

    switch (parsed.type) {
      case 'user':
      case 'assistant':
      case 'system':
      case 'summary':
      case 'compact_boundary':
        return parsed as SessionRecord
      default:
        // Accept any record with a type field — future-proof
        return parsed as SessionRecord
    }
  } catch {
    return null
  }
}

/**
 * Parse an entire JSONL file into an array of records.
 */
export async function parseJsonlFile(filePath: string): Promise<SessionRecord[]> {
  const content = await readFile(filePath, 'utf-8')
  const lines = content.split('\n')
  const records: SessionRecord[] = []

  for (const line of lines) {
    const record = parseJsonlLine(line)
    if (record) {
      records.push(record)
    }
  }

  return records
}

/**
 * Extract turn metrics from a sequence of records.
 * A "turn" is defined as a user message followed by an assistant response.
 */
export function extractTurns(records: SessionRecord[]): TurnMetrics[] {
  const turns: TurnMetrics[] = []
  let turnIndex = 0

  for (const record of records) {
    if (record.type !== 'assistant') continue
    const assistant = record as AssistantRecord
    if (!assistant.message?.usage) continue

    const usage = normalizeUsage(assistant.message.usage)
    const totalInput =
      usage.input_tokens +
      usage.cache_creation_input_tokens +
      usage.cache_read_input_tokens

    const cacheRatio = totalInput > 0 ? usage.cache_read_input_tokens / totalInput : 0

    const toolCalls: ToolCallSummary[] = (assistant.message.content || [])
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({
        name: block.name || 'unknown',
        inputHash: hashValue(block.input),
        outputHash: '', // filled in when tool_result is matched
      }))

    turns.push({
      turnIndex: turnIndex++,
      timestamp: assistant.timestamp,
      usage,
      cacheRatio,
      toolCalls,
    })
  }

  // Match tool results to tool calls for output hashes.
  // In real Claude Code JSONL files, tool results are embedded as content
  // blocks inside user messages (type: "tool_result" with tool_use_id),
  // not as top-level records.
  const toolResultMap = new Map<string, string>()

  for (const record of records) {
    // Check top-level tool_result records (spec format)
    if (record.type === 'tool_result' && 'toolUseId' in record) {
      const tr = record as { toolUseId: string; content: string }
      toolResultMap.set(tr.toolUseId, tr.content)
    }

    // Check user messages for embedded tool_result content blocks (real format)
    if (record.type === 'user') {
      const userMsg = record as UserRecord
      const content = userMsg.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block &&
            typeof block === 'object' &&
            'type' in block &&
            (block as Record<string, unknown>).type === 'tool_result'
          ) {
            const toolBlock = block as Record<string, unknown>
            const toolUseId = toolBlock.tool_use_id as string
            const resultContent = toolBlock.content
            if (toolUseId && resultContent) {
              const resultStr =
                typeof resultContent === 'string'
                  ? resultContent
                  : JSON.stringify(resultContent)
              toolResultMap.set(toolUseId, resultStr)
            }
          }
        }
      }
    }
  }

  for (const turn of turns) {
    for (const call of turn.toolCalls) {
      const assistantRecords = records.filter(
        (r) => r.type === 'assistant'
      ) as AssistantRecord[]

      for (const ar of assistantRecords) {
        for (const block of ar.message.content || []) {
          if (
            block.type === 'tool_use' &&
            block.name === call.name &&
            hashValue(block.input) === call.inputHash &&
            block.id
          ) {
            const result = toolResultMap.get(block.id)
            if (result) {
              call.outputHash = hashValue(result)
            }
          }
        }
      }
    }
  }

  return turns
}

/**
 * Aggregate total token usage across all turns.
 */
export function aggregateUsage(turns: TurnMetrics[]): TokenUsage {
  return turns.reduce(
    (acc, turn) => ({
      input_tokens: acc.input_tokens + turn.usage.input_tokens,
      output_tokens: acc.output_tokens + turn.usage.output_tokens,
      cache_creation_input_tokens:
        acc.cache_creation_input_tokens + turn.usage.cache_creation_input_tokens,
      cache_read_input_tokens:
        acc.cache_read_input_tokens + turn.usage.cache_read_input_tokens,
    }),
    {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
  )
}

/**
 * Extract the model ID from assistant records.
 * Uses the most recent assistant record's model field.
 */
export function extractModel(records: SessionRecord[]): string | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]
    if (record.type === 'assistant') {
      const assistant = record as AssistantRecord
      if (assistant.message?.model) {
        return assistant.message.model
      }
    }
  }
  return null
}

export interface SessionContext {
  cwd: string | null
  gitBranch: string | null
  projectName: string | null
  firstUserMessage: string | null
}

/**
 * Extract human-readable session context from user records.
 * Pulls the working directory and git branch from the most recent
 * user record that has them.
 */
export function extractSessionContext(records: SessionRecord[]): SessionContext {
  let cwd: string | null = null
  let gitBranch: string | null = null

  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]
    if (record.type === 'user') {
      const user = record as UserRecord
      if (!cwd && user.cwd) cwd = user.cwd
      if (!gitBranch && user.gitBranch) gitBranch = user.gitBranch
      if (cwd && gitBranch) break
    }
  }

  // Derive a short project name from the cwd
  // Works on both Unix (/) and Windows (\) paths
  const projectName = cwd ? cwd.split(/[/\\]/).filter(Boolean).pop() ?? null : null

  // Extract first user message — useful for subagent labeling
  let firstUserMessage: string | null = null
  for (const record of records) {
    if (record.type === 'user') {
      const user = record as UserRecord
      const content = user.message?.content
      if (typeof content === 'string' && content.trim()) {
        firstUserMessage = content.trim()
        break
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === 'object' && 'type' in block) {
            const b = block as Record<string, unknown>
            if (b.type === 'text' && typeof b.text === 'string') {
              firstUserMessage = (b.text as string).trim()
              break
            }
          }
        }
        if (firstUserMessage) break
      }
    }
  }

  return { cwd, gitBranch, projectName, firstUserMessage }
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
