import type { SessionState, TurnMetrics, ToolCallSummary } from '../types.js'
import type { SubagentSignal } from './subagent-intel.js'

export interface WorkflowPattern {
  /** Normalized sequence of tool calls */
  steps: WorkflowStep[]
  /** How many sessions this pattern appeared in */
  sessionCount: number
  /** Session labels where it was seen */
  seenIn: string[]
  /** A short fingerprint for dedup */
  fingerprint: string
}

export interface WorkflowStep {
  tool: string
  /** Normalized command/input (e.g. "npm test", "*.test.ts") */
  input: string
}

export interface SkillSuggestion {
  name: string
  pattern: WorkflowPattern
  /** The prompt to inject into Claude's context */
  prompt: string
}

const MIN_SESSIONS = 3
const MIN_SEQUENCE_LENGTH = 2
const MAX_SEQUENCE_LENGTH = 8

/**
 * Detect repeating tool call workflows across sessions.
 *
 * Extracts Bash command sequences and Edit/Write file patterns,
 * normalizes them, and finds sequences that appear in 3+ sessions.
 */
// Map from hash-based key to human-readable label
const hashLabels = new Map<string, string>()

export function detectWorkflowPatterns(sessions: SessionState[]): WorkflowPattern[] {
  // Extract normalized tool sequences from each session
  const sessionSequences = new Map<string, { sequences: string[][]; label: string }>()

  for (const session of sessions) {
    if (session.turns.length < 3) continue

    // Collect hash→label mappings from this session
    for (const turn of session.turns) {
      for (const call of turn.toolCalls) {
        if (call.name === 'Bash' && call.inputLabel) {
          hashLabels.set(call.inputHash.slice(0, 8), call.inputLabel)
        }
      }
    }

    const steps = extractNormalizedSteps(session.turns)
    if (steps.length < MIN_SEQUENCE_LENGTH) continue
    sessionSequences.set(session.filePath, { sequences: extractSubsequences(steps), label: session.label })
  }

  // Count how many sessions each subsequence appears in
  const patternCounts = new Map<string, { steps: WorkflowStep[]; sessions: Set<string> }>()

  for (const [filePath, { sequences, label }] of sessionSequences) {
    // Deduplicate within a session — only count each pattern once per session
    const seenInSession = new Set<string>()

    for (const seq of sequences) {
      const fingerprint = seq.join(' → ')
      if (seenInSession.has(fingerprint)) continue
      seenInSession.add(fingerprint)

      if (!patternCounts.has(fingerprint)) {
        patternCounts.set(fingerprint, {
          steps: seq.map(parseStep),
          sessions: new Set(),
        })
      }
      patternCounts.get(fingerprint)!.sessions.add(label)
    }
  }

  // Filter to patterns seen in MIN_SESSIONS+ sessions
  const patterns: WorkflowPattern[] = []

  for (const [fingerprint, { steps, sessions }] of patternCounts) {
    if (sessions.size >= MIN_SESSIONS) {
      patterns.push({
        steps,
        sessionCount: sessions.size,
        seenIn: Array.from(sessions).slice(0, 5),
        fingerprint,
      })
    }
  }

  // Sort by frequency, then by length (longer = more specific)
  patterns.sort((a, b) => {
    if (b.sessionCount !== a.sessionCount) return b.sessionCount - a.sessionCount
    return b.steps.length - a.steps.length
  })

  // Deduplicate: remove patterns that are subsequences of longer patterns
  return deduplicatePatterns(patterns).slice(0, 5)
}

/**
 * Generate skill suggestions from detected patterns.
 */
export function generateSkillSuggestions(patterns: WorkflowPattern[]): SkillSuggestion[] {
  return patterns.map((pattern) => {
    const name = generateSkillName(pattern)
    const stepsDescription = pattern.steps
      .map((s, i) => `  ${i + 1}. ${s.tool}: ${s.input}`)
      .join('\n')

    const prompt =
      `[clauditor — skill suggestion]: You've repeated this workflow in ${pattern.sessionCount} sessions:\n` +
      `${stepsDescription}\n\n` +
      `Ask the user: "I noticed you frequently run this workflow. Want me to create a /${name} skill ` +
      `at .claude/skills/${name}/SKILL.md so you can run it with one command?"\n\n` +
      `If the user agrees, create the skill directory and SKILL.md with:\n` +
      `- Proper YAML frontmatter (name, description, disable-model-invocation: true)\n` +
      `- Clear step-by-step instructions based on the workflow above\n` +
      `- Any relevant arguments using $ARGUMENTS substitution\n\n` +
      `If the user declines, drop it and continue with their request.`

    return { name, pattern, prompt }
  })
}

/**
 * Format skill suggestions for terminal display.
 */
export function formatSkillSuggestions(suggestions: SkillSuggestion[]): string {
  if (suggestions.length === 0) {
    return '  No repeating workflows found yet.\n  Use Claude Code for a few more sessions — patterns emerge over time.'
  }

  const lines: string[] = []

  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i]
    lines.push(`  ${i + 1}. "${s.name}" (seen in ${s.pattern.sessionCount} sessions)`)
    for (const step of s.pattern.steps) {
      lines.push(`     ${step.tool}: ${step.input}`)
    }
    lines.push(`     → Run \`clauditor install\` to enable, then Claude will suggest creating this skill`)
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Extract normalized tool call steps from turns.
 * Returns strings like "Bash:npm test", "Edit:*.test.ts"
 */
function extractNormalizedSteps(turns: TurnMetrics[]): string[] {
  const steps: string[] = []

  for (const turn of turns) {
    for (const call of turn.toolCalls) {
      const normalized = normalizeToolCall(call)
      if (normalized) steps.push(normalized)
    }
  }

  return steps
}

/**
 * Normalize a tool call to a comparable string.
 *
 * ONLY tracks Bash commands — Read/Edit/Grep/Glob are too generic
 * ("Read file, Read file" is not a workflow, it's just using Claude Code).
 * Bash commands have distinct, meaningful inputs: npm test, git push, etc.
 */
function normalizeToolCall(call: ToolCallSummary): string | null {
  if (call.name !== 'Bash') return null
  // Use the inputHash as a proxy — same hash = same command
  return `Bash:${call.inputHash.slice(0, 8)}`
}

/**
 * Extract all contiguous subsequences of length MIN..MAX from a sequence.
 */
function extractSubsequences(steps: string[]): string[][] {
  const results: string[][] = []

  for (let len = MIN_SEQUENCE_LENGTH; len <= Math.min(MAX_SEQUENCE_LENGTH, steps.length); len++) {
    for (let i = 0; i <= steps.length - len; i++) {
      results.push(steps.slice(i, i + len))
    }
  }

  return results
}

function parseStep(stepStr: string): WorkflowStep {
  const colonIdx = stepStr.indexOf(':')
  if (colonIdx === -1) return { tool: stepStr, input: '' }
  const tool = stepStr.slice(0, colonIdx)
  const hash = stepStr.slice(colonIdx + 1)
  // Resolve hash to human-readable label
  const label = hashLabels.get(hash) || hash
  return { tool, input: label }
}

/**
 * Remove patterns that are strict subsequences of longer patterns.
 */
function deduplicatePatterns(patterns: WorkflowPattern[]): WorkflowPattern[] {
  const result: WorkflowPattern[] = []

  for (const pattern of patterns) {
    const isSubsequence = result.some((existing) =>
      existing.fingerprint.includes(pattern.fingerprint) &&
      existing.fingerprint !== pattern.fingerprint
    )
    if (!isSubsequence) {
      result.push(pattern)
    }
  }

  return result
}

/**
 * Generate skill suggestions from subagent patterns.
 *
 * Subagent descriptions are the richest signal for recurring workflows.
 * "Fix post-merge build errors" appearing 3+ times across sessions
 * is a strong candidate for a skill.
 */
export function generateSubagentSkillSuggestions(
  signals: SubagentSignal[],
  minOccurrences = 3
): SkillSuggestion[] {
  // Import here to avoid circular deps at module level
  const { detectPatterns } = require('./subagent-intel.js') as typeof import('./subagent-intel.js')

  const patterns = detectPatterns(signals)
  const suggestions: SkillSuggestion[] = []

  for (const pattern of patterns) {
    if (pattern.count < minOccurrences) continue

    const name = pattern.pattern
      .replace(/\b(batch|group)\s*n\b/gi, '')
      .replace(/[^a-z0-9\s]/gi, '')
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join('-')
      .toLowerCase() || 'workflow'

    const prompt =
      `[clauditor — skill suggestion from agent patterns]: Claude spawned agents for "${pattern.descriptions[0]}" ` +
      `${pattern.count} times across sessions.\n\n` +
      `Ask the user: "I noticed you frequently need '${pattern.descriptions[0]}'. ` +
      `Want me to create a /${name} skill so this runs automatically?"\n\n` +
      `If the user agrees, create .claude/skills/${name}/SKILL.md.`

    suggestions.push({
      name,
      pattern: {
        steps: [{ tool: 'Agent', input: pattern.descriptions[0] }],
        sessionCount: pattern.count,
        seenIn: pattern.descriptions.slice(0, 5),
        fingerprint: `subagent:${pattern.pattern}`,
      },
      prompt,
    })
  }

  return suggestions.slice(0, 3)
}

/**
 * Generate a kebab-case skill name from a workflow pattern.
 */
function generateSkillName(pattern: WorkflowPattern): string {
  // Extract the first meaningful command word from each step
  const keywords: string[] = []
  for (const step of pattern.steps) {
    if (step.tool === 'Bash' && step.input) {
      // Extract the base command: "npm test" → "test", "git push" → "push"
      const parts = step.input.trim().split(/\s+/)
      if (parts[0] === 'npm' || parts[0] === 'npx' || parts[0] === 'yarn' || parts[0] === 'pnpm') {
        keywords.push(parts[1] || parts[0])
      } else if (parts[0] === 'git') {
        keywords.push(parts[1] || 'git')
      } else {
        keywords.push(parts[0])
      }
    }
  }

  if (keywords.length === 0) return 'workflow'

  // Deduplicate and join
  const unique = [...new Set(keywords)].slice(0, 3)
  return unique.join('-').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'workflow'
}
