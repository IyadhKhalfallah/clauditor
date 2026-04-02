import type { SessionState, TurnMetrics, ToolCallSummary } from '../types.js'

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
export function detectWorkflowPatterns(sessions: SessionState[]): WorkflowPattern[] {
  // Extract normalized tool sequences from each session
  const sessionSequences = new Map<string, { sequences: string[][]; label: string }>()

  for (const session of sessions) {
    if (session.turns.length < 3) continue
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
 * Strips session-specific details, keeps the command structure.
 */
function normalizeToolCall(call: ToolCallSummary): string | null {
  const { name } = call

  // We only track tools that form meaningful workflow patterns
  switch (name) {
    case 'Bash':
      // Use the inputHash as a proxy — same hash = same command
      return `Bash:${call.inputHash.slice(0, 8)}`
    case 'Edit':
    case 'Write':
      return `${name}:file`
    case 'Read':
      return `Read:file`
    case 'Grep':
      return `Grep:search`
    case 'Glob':
      return `Glob:find`
    default:
      return null // Skip Agent, TodoWrite, etc.
  }
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
  return {
    tool: stepStr.slice(0, colonIdx),
    input: stepStr.slice(colonIdx + 1),
  }
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
 * Generate a kebab-case skill name from a workflow pattern.
 */
function generateSkillName(pattern: WorkflowPattern): string {
  const tools = pattern.steps.map((s) => s.tool.toLowerCase())
  const unique = [...new Set(tools)]

  // Try to name it by the dominant tool combination
  if (unique.length === 1 && unique[0] === 'bash') {
    return 'run-workflow'
  }

  if (unique.includes('bash') && (unique.includes('edit') || unique.includes('write'))) {
    return 'test-fix-verify'
  }

  if (unique.includes('grep') || unique.includes('read')) {
    return 'search-and-review'
  }

  return `workflow-${unique.slice(0, 3).join('-')}`
}
