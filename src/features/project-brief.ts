import { readErrorIndex } from './error-index.js'
import { readFileIndex } from './file-tracker.js'
import { readRecentHandoffs } from './session-state.js'

/**
 * Build a compact project brief from local knowledge.
 *
 * Assembles error index, file tracker, and recent session data into
 * a markdown brief (< 500 tokens) that gives Claude useful project
 * context at session start. No LLM, no network — pure local data.
 *
 * Returns null if there's nothing useful to inject.
 */
export function buildProjectBrief(cwd: string): string | null {
  const sections: string[] = []

  // 1. Known errors with fixes (most actionable)
  const errorSection = buildErrorSection(cwd)
  if (errorSection) sections.push(errorSection)

  // 2. Hot files — frequently edited, multi-session files
  const fileSection = buildFileSection(cwd)
  if (fileSection) sections.push(fileSection)

  // 3. Recent work summary (from last PostCompact)
  const recentSection = buildRecentSection(cwd)
  if (recentSection) sections.push(recentSection)

  if (sections.length === 0) return null

  const brief = `[clauditor — project knowledge]:\n` + sections.join('\n\n')

  // Hard cap at ~2000 chars to stay under 500 tokens
  return brief.length > 2000 ? brief.slice(0, 2000) + '\n...' : brief
}

/**
 * Known errors — top errors with fixes, plus frequent unfixed errors.
 */
function buildErrorSection(cwd: string): string | null {
  const errors = readErrorIndex(cwd)
  if (errors.length === 0) return null

  const withFixes = errors
    .filter((e) => e.fix)
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 5)

  const frequentUnfixed = errors
    .filter((e) => !e.fix && e.occurrences >= 3)
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 3)

  if (withFixes.length === 0 && frequentUnfixed.length === 0) return null

  const lines: string[] = ['## Known errors']

  for (const e of withFixes) {
    lines.push(
      `- \`${truncate(e.command, 60)}\`: ${truncate(e.error, 80)}` +
      `\n  Fix: \`${truncate(e.fix!, 80)}\` (${e.occurrences}x)`
    )
  }

  for (const e of frequentUnfixed) {
    lines.push(
      `- \`${truncate(e.command, 60)}\`: ${truncate(e.error, 80)} (${e.occurrences}x, no fix yet)`
    )
  }

  return lines.join('\n')
}

/**
 * Hot files — files with high edit counts across multiple sessions.
 * These are the files Claude is most likely to touch again.
 */
function buildFileSection(cwd: string): string | null {
  const index = readFileIndex(cwd)
  const entries = Object.entries(index)
  if (entries.length === 0) return null

  // Hot files: 3+ edits AND 2+ sessions
  const hot = entries
    .filter(([, e]) => e.editCount >= 3 && e.sessions >= 2)
    .sort(([, a], [, b]) => b.editCount - a.editCount)
    .slice(0, 8)

  if (hot.length === 0) return null

  const lines: string[] = ['## Active files']
  for (const [name, e] of hot) {
    lines.push(
      `- \`${name}\` — ${e.editCount} edits, ${e.sessions} sessions` +
      (e.lastEdited ? `, last ${e.lastEdited}` : '')
    )
  }

  return lines.join('\n')
}

/**
 * Recent work — extract a one-liner from the most recent session summary
 * to provide continuity context (without the full handoff injection).
 */
function buildRecentSection(cwd: string): string | null {
  try {
    const handoffs = readRecentHandoffs(cwd)
    if (handoffs.length === 0) return null

    // Take the most recent handoff that belongs to THIS project
    const latest = handoffs.find((h) => !h.project || h.project === cwd)
    if (!latest) return null

    // Extract the task/summary line (first meaningful line of content)
    const lines = latest.content.split('\n').filter((l: string) => l.trim().length > 0)
    const taskLine = lines.find((l: string) =>
      l.includes('Task:') || l.includes('## ') || l.startsWith('**')
    )

    if (!taskLine) return null

    const timeAgo = Math.round((Date.now() - latest.timestamp) / 60000)
    const timeStr = timeAgo < 60 ? `${timeAgo}m ago` : `${Math.round(timeAgo / 60)}h ago`

    return `## Last session (${timeStr})\n${truncate(taskLine.replace(/^[#*\s]+/, ''), 150)}`
  } catch {
    return null
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}
