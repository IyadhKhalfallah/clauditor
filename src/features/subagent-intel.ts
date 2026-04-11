/**
 * Subagent Intelligence — extract signals from Claude Code's subagent metadata.
 *
 * Claude Code stores subagent data at:
 *   ~/.claude/projects/<project>/<session-id>/subagents/
 *     agent-<id>.meta.json  — { agentType, description }
 *     agent-<id>.jsonl      — full subagent transcript
 *
 * This module reads meta files (zero LLM cost) and extracts:
 * - Task descriptions and categories
 * - Recurring patterns across sessions
 * - Files touched by subagents
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { homedir } from 'node:os'

export type SubagentCategory = 'fix' | 'query' | 'research' | 'find' | 'check' | 'create' | 'other'

export interface SubagentSignal {
  sessionId: string
  agentId: string
  agentType: string
  description: string
  category: SubagentCategory
  filesTouched: string[]
  turnCount: number
  timestamp: number // mtime of meta file
}

export interface SubagentSummary {
  total: number
  byCategory: Record<SubagentCategory, number>
  byAgentType: Record<string, number>
  signals: SubagentSignal[]
}

/**
 * Scan all subagents for a project directory.
 * Reads only .meta.json files (fast, zero LLM cost).
 */
export function scanSubagents(cwd: string): SubagentSummary {
  const projectDir = findProjectDir(cwd)
  if (!projectDir) return emptySummary()

  const signals: SubagentSignal[] = []

  try {
    const entries = readdirSync(projectDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      // Session directories are UUIDs
      if (!isUUID(entry.name)) continue

      const subagentsDir = resolve(projectDir, entry.name, 'subagents')
      if (!existsSync(subagentsDir)) continue

      const sessionId = entry.name

      try {
        const files = readdirSync(subagentsDir)
        const metaFiles = files.filter(f => f.endsWith('.meta.json'))

        for (const metaFile of metaFiles) {
          try {
            const metaPath = resolve(subagentsDir, metaFile)
            const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
            const mtime = statSync(metaPath).mtimeMs

            if (!meta.description) continue

            // Extract agent ID from filename: agent-<id>.meta.json
            const agentId = basename(metaFile, '.meta.json')

            // Lightweight file extraction from transcript
            const jsonlFile = metaFile.replace('.meta.json', '.jsonl')
            const jsonlPath = resolve(subagentsDir, jsonlFile)
            const { files: filesTouched, turnCount } = extractTranscriptMeta(jsonlPath)

            signals.push({
              sessionId,
              agentId,
              agentType: meta.agentType || 'unknown',
              description: meta.description,
              category: classifySubagent(meta.description),
              filesTouched,
              turnCount,
              timestamp: mtime,
            })
          } catch {
            // Skip unreadable meta files
          }
        }
      } catch {
        // Skip unreadable session dirs
      }
    }
  } catch {
    return emptySummary()
  }

  return buildSummary(signals)
}

/**
 * Scan subagents for a single session only.
 * Used by the stop hook to push signals for the current session.
 */
export function scanSessionSubagents(cwd: string, sessionId: string): SubagentSignal[] {
  const projectDir = findProjectDir(cwd)
  if (!projectDir) return []

  const subagentsDir = resolve(projectDir, sessionId, 'subagents')
  if (!existsSync(subagentsDir)) return []

  const signals: SubagentSignal[] = []

  try {
    const files = readdirSync(subagentsDir)
    const metaFiles = files.filter(f => f.endsWith('.meta.json'))

    for (const metaFile of metaFiles) {
      try {
        const metaPath = resolve(subagentsDir, metaFile)
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
        const mtime = statSync(metaPath).mtimeMs

        if (!meta.description) continue

        const agentId = basename(metaFile, '.meta.json')
        const jsonlFile = metaFile.replace('.meta.json', '.jsonl')
        const jsonlPath = resolve(subagentsDir, jsonlFile)
        const { files: filesTouched, turnCount } = extractTranscriptMeta(jsonlPath)

        signals.push({
          sessionId,
          agentId,
          agentType: meta.agentType || 'unknown',
          description: meta.description,
          category: classifySubagent(meta.description),
          filesTouched,
          turnCount,
          timestamp: mtime,
        })
      } catch {
        // Skip
      }
    }
  } catch {
    // Skip
  }

  return signals
}

/**
 * Classify a subagent description into a category.
 * Uses keyword matching — no LLM needed.
 */
export function classifySubagent(description: string): SubagentCategory {
  const lower = description.toLowerCase()

  // Order matters — more specific patterns first
  if (/\b(fix|resolve|repair|patch|correct)\b/.test(lower)) return 'fix'
  if (/\b(create|build|implement|write|generate|draft)\b/.test(lower)) return 'create'
  if (/\b(query|search|grep|find.*in|look.*for)\b/.test(lower)) return 'query'
  if (/\b(check|verify|validate|test|confirm)\b/.test(lower)) return 'check'
  if (/\b(research|investigate|explore|understand|how|why)\b/.test(lower)) return 'research'
  if (/\b(find|trace|locate|discover)\b/.test(lower)) return 'find'

  return 'other'
}

/**
 * Detect recurring patterns across subagent descriptions.
 * Groups similar descriptions and returns those appearing 2+ times.
 */
export function detectPatterns(signals: SubagentSignal[]): Array<{
  pattern: string
  count: number
  category: SubagentCategory
  descriptions: string[]
}> {
  // Normalize descriptions for grouping
  const groups = new Map<string, { descriptions: string[]; category: SubagentCategory }>()

  for (const signal of signals) {
    const key = normalizeDescription(signal.description)
    const existing = groups.get(key)
    if (existing) {
      existing.descriptions.push(signal.description)
    } else {
      groups.set(key, {
        descriptions: [signal.description],
        category: signal.category,
      })
    }
  }

  return Array.from(groups.entries())
    .filter(([, v]) => v.descriptions.length >= 2)
    .map(([pattern, v]) => ({
      pattern,
      count: v.descriptions.length,
      category: v.category,
      descriptions: v.descriptions,
    }))
    .sort((a, b) => b.count - a.count)
}

// ─── Helpers ────────────────────────────────────────────────

function findProjectDir(cwd: string): string | null {
  const claudeProjectsDir = resolve(homedir(), '.claude', 'projects')
  if (!existsSync(claudeProjectsDir)) return null

  try {
    const dirs = readdirSync(claudeProjectsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())

    const encoded = cwd.replace(/[^a-zA-Z0-9]/g, '-')

    for (const dir of dirs) {
      if (dir.name.includes(encoded.slice(0, 30)) || encoded.includes(dir.name.slice(0, 30))) {
        return resolve(claudeProjectsDir, dir.name)
      }
    }
  } catch {}

  return null
}

function isUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

/**
 * Extract lightweight metadata from a subagent transcript.
 * Only reads file paths from tool_use calls — does NOT parse full content.
 */
function extractTranscriptMeta(jsonlPath: string): { files: string[]; turnCount: number } {
  if (!existsSync(jsonlPath)) return { files: [], turnCount: 0 }

  try {
    const content = readFileSync(jsonlPath, 'utf-8')
    const lines = content.split('\n').filter(l => l.trim())
    const files = new Set<string>()
    let turnCount = 0

    for (const line of lines) {
      try {
        const record = JSON.parse(line)
        if (record.type === 'assistant') turnCount++

        // Extract file paths from tool_use inputs
        if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
          for (const block of record.message.content) {
            if (block.type === 'tool_use') {
              const input = block.input
              if (input?.file_path) files.add(normalizeFilePath(input.file_path))
              if (input?.path) files.add(normalizeFilePath(input.path))
              if (input?.command) {
                // Extract file paths from common shell commands
                const pathMatches = input.command.match(/(?:^|\s)((?:\/|\.\/)\S+\.\w+)/g)
                if (pathMatches) {
                  for (const m of pathMatches) {
                    files.add(normalizeFilePath(m.trim()))
                  }
                }
              }
            }
          }
        }
      } catch {
        // Skip unparseable lines
      }
    }

    // Filter out non-source paths (tool-results caches, temp files, etc.)
    const filtered = Array.from(files).filter(f =>
      !f.includes('tool-results') &&
      !f.includes('subagents/') &&
      !f.includes('.jsonl') &&
      !f.startsWith('/tmp/')
    )
    return { files: filtered.slice(0, 20), turnCount }
  } catch {
    return { files: [], turnCount: 0 }
  }
}

function normalizeFilePath(path: string): string {
  // Strip absolute path prefixes to get relative paths
  return path.replace(/^\/Users\/[^/]+\/[^/]+\/[^/]+\/[^/]+\//, '')
}

/**
 * Normalize a description for pattern grouping.
 * Strips specific identifiers to group similar tasks.
 */
function normalizeDescription(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/\b(batch|group)\s*\d+\b/g, 'batch N')        // "batch 1" → "batch N"
    .replace(/\b(pr|issue|ticket)\s*#?\d+\b/g, '$1 N')      // "PR #123" → "PR N"
    .replace(/\b[a-f0-9]{7,40}\b/g, 'HASH')                 // git hashes
    .replace(/\b\d{4,}\b/g, 'N')                              // large numbers (ticket IDs)
    .replace(/\s+/g, ' ')
    .trim()
}

function emptySummary(): SubagentSummary {
  return {
    total: 0,
    byCategory: { fix: 0, query: 0, research: 0, find: 0, check: 0, create: 0, other: 0 },
    byAgentType: {},
    signals: [],
  }
}

function buildSummary(signals: SubagentSignal[]): SubagentSummary {
  const byCategory: Record<SubagentCategory, number> = { fix: 0, query: 0, research: 0, find: 0, check: 0, create: 0, other: 0 }
  const byAgentType: Record<string, number> = {}

  for (const s of signals) {
    byCategory[s.category]++
    byAgentType[s.agentType] = (byAgentType[s.agentType] || 0) + 1
  }

  return { total: signals.length, byCategory, byAgentType, signals }
}
