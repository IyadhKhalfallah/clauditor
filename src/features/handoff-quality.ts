/**
 * Handoff Quality — measures information loss during session rotation.
 *
 * Based on current research (2025-2026):
 *
 * - Size-Fidelity Paradox (arxiv 2602.09789, Feb 2026): LLM summaries suffer from
 *   "knowledge overwriting" (replacing facts with priors) and "semantic drift"
 *   (paraphrasing changes meaning). Larger models are worse at faithful compression.
 *
 * - Tang et al. (2023): summaries preferentially lose conditional info ("if X then Y"),
 *   negative constraints ("don't do X"), temporal sequencing, and causal chains.
 *
 * - LongMemEval (ICLR 2025): 30% accuracy drop on memorizing information across
 *   sustained interactions. Defines 5 memory abilities: extraction, reasoning,
 *   temporal reasoning, knowledge updates, abstention.
 *
 * - FactScore (Min et al.): decompose-then-verify for atomic facts.
 *   We use a mechanical (no LLM) variant that extracts verifiable facts from
 *   JSONL transcripts and checks preservation in the handoff summary.
 *
 * Architecture: the handoff should be primarily mechanical structured state
 * (files, errors, commands), with Claude's prose as supplementary context.
 * Measuring both tells us where each fails.
 */

import { readFileSync } from 'node:fs'

// ─── Types ──────────────────────────────────────────────────

export type FactCategory =
  | 'file_modified'      // Files that were changed (weight: 0.9)
  | 'file_read'          // Files that were consulted (weight: 0.3)
  | 'error_hit'          // Errors encountered (weight: 0.7)
  | 'error_fixed'        // Errors that were resolved (weight: 0.9)
  | 'commit'             // Git commits made (weight: 0.8)
  | 'command_run'        // Key commands executed (weight: 0.4)
  | 'approach_rejected'  // Things tried and abandoned (weight: 1.0) — Tang: most commonly lost
  | 'user_preference'    // User constraints/preferences (weight: 1.0) — Tang: most commonly lost
  | 'conditional'        // "if X then Y" relationships (weight: 0.9) — Tang: most commonly lost
  | 'temporal_sequence'  // Order of operations that mattered (weight: 0.7)

export interface TranscriptFact {
  category: FactCategory
  value: string
  /** How important this fact is for session continuity (0-1) */
  weight: number
  /** Turn number where this fact was established */
  turn?: number
}

export interface HandoffScore {
  totalFacts: number
  preservedFacts: number
  /** Weighted preservation score (0-1) */
  score: number
  categories: Record<string, { total: number; preserved: number }>
  lostFacts: TranscriptFact[]
  /** Detected knowledge overwriting instances (Size-Fidelity Paradox) */
  overwriteDetections: OverwriteDetection[]
  /** Detected semantic drift instances */
  driftDetections: DriftDetection[]
}

/** When the summary replaces a specific fact with a more "expected" version */
export interface OverwriteDetection {
  originalFact: string
  summaryVersion: string
  category: FactCategory
}

/** When the summary changes ordering or causality */
export interface DriftDetection {
  description: string
  originalOrder: string[]
  summaryOrder: string[]
}

export interface NewSessionSignals {
  redundantReads: string[]
  rediscoveryTurns: number
  repeatedErrors: string[]
  /** User corrections — phrases like "I already told you", "we tried that" */
  userCorrections: string[]
}

// ─── Fact Extraction from Transcript ────────────────────────

/**
 * Extract verifiable atomic facts from a JSONL transcript.
 * Focuses on categories most prone to loss (Tang et al.):
 * conditional info, negative constraints, temporal sequence.
 */
export function extractFacts(transcriptPath: string): TranscriptFact[] {
  const facts: TranscriptFact[] = []

  let lines: string[]
  try {
    lines = readFileSync(transcriptPath, 'utf-8').split('\n').filter(l => l.trim())
  } catch {
    return []
  }

  const filesModified = new Set<string>()
  const filesRead = new Set<string>()
  const errorsHit = new Map<string, number>() // error → turn
  const errorsFixed = new Set<string>()
  const commits = new Set<string>()
  const keyCommands: Array<{ cmd: string; turn: number }> = []
  const userPreferences = new Set<string>()
  const approachesRejected = new Set<string>()
  const conditionals = new Set<string>()

  let turnNumber = 0
  let lastErrorCommand: string | null = null

  for (const line of lines) {
    let r: Record<string, unknown>
    try { r = JSON.parse(line) } catch { continue }

    if (r.type === 'assistant' && r.message && typeof r.message === 'object') {
      turnNumber++
      const msg = r.message as { content?: Array<Record<string, unknown>> }
      if (!Array.isArray(msg.content)) continue

      // Extract assistant text for approach rejection detection
      const textBlocks = msg.content
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)

      for (const text of textBlocks) {
        // Detect rejected approaches — "tried X but", "reverted", "that didn't work"
        // Extract the full sentence containing the rejection for context
        const sentences = text.split(/[.!?\n]/).map(s => s.trim()).filter(s => s.length > 15)
        for (const sentence of sentences) {
          const isRejection =
            /(?:tried|attempted)\s+.{5,}?\s+(?:but|however|which\s+didn't|didn't\s+work)/i.test(sentence) ||
            /(?:reverted|rolled back|undid)\s+.{5,}/i.test(sentence) ||
            /(?:abandoned|scrapped|dropped)\s+.{5,}\s+approach/i.test(sentence)
          if (isRejection) {
            approachesRejected.add(sentence.slice(0, 120))
          }
        }

        // Detect conditional relationships — "if X then Y", "X requires Y", "must Y before X"
        // Must have BOTH a condition and a consequence to be a real conditional
        const condPatterns = [
          /(?:you\s+)?(?:need|must|have)\s+to\s+(.{15,80})\s+(?:before|first|prior\s+to)\s+(.{10,})/i,
          /(?:if\s+)(.{15,80}),?\s+(?:then\s+|you\s+should\s+|it\s+will\s+)(.{10,})/i,
          /(?:won't|can't|doesn't)\s+work\s+(?:without|unless)\s+(.{15,80})/i,
        ]
        for (const pat of condPatterns) {
          const m = text.match(pat)
          if (m) conditionals.add((m[1] || m[0]).slice(0, 100))
        }
      }

      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue

        if (block.name === 'Edit' || block.name === 'Write') {
          const fp = (block.input as Record<string, unknown>)?.file_path as string
          if (fp) filesModified.add(normalizeForComparison(fp))
        }

        if (block.name === 'Read') {
          const fp = (block.input as Record<string, unknown>)?.file_path as string
          if (fp) filesRead.add(normalizeForComparison(fp))
        }

        if (block.name === 'Bash') {
          const cmd = (block.input as Record<string, unknown>)?.command as string
          if (!cmd) continue

          if (cmd.includes('git') && cmd.includes('commit')) {
            // Standard: -m "message" or -m 'message'
            const stdMatch = cmd.match(/-m\s+"([^"\n]{5,})"/) || cmd.match(/-m\s+'([^'\n]{5,})'/)
            if (stdMatch) {
              commits.add(stdMatch[1].trim().slice(0, 100))
            } else {
              // HEREDOC: -m "$(cat <<'EOF'\nmessage\nEOF)"
              const heredocMatch = cmd.match(/<<['"]?EOF['"]?\)?\s*\n\s*([^\n]{5,})/)
              if (heredocMatch && !heredocMatch[1].startsWith('$(')) {
                commits.add(heredocMatch[1].trim().slice(0, 100))
              }
            }
          }

          if (/\b(test|build|deploy|lint|migrate)\b/i.test(cmd) && !cmd.includes('git')) {
            const shortCmd = cmd.split('\n')[0].split('|')[0].split('&&')[0].trim().slice(0, 80)
            // Deduplicate — only add if this base command isn't already tracked
            const baseCmd = shortCmd.split(/\s+/).slice(0, 3).join(' ')
            if (!keyCommands.some(k => k.cmd.startsWith(baseCmd))) {
              keyCommands.push({ cmd: shortCmd, turn: turnNumber })
            }
          }

          lastErrorCommand = cmd
        }
      }
    }

    // Extract from tool results
    if (r.type === 'user' && r.message && typeof r.message === 'object') {
      const msg = r.message as { content?: Array<Record<string, unknown>> }
      if (!Array.isArray(msg.content)) continue

      for (const block of msg.content) {
        if (block.type === 'tool_result' && typeof block.content === 'string') {
          const content = block.content
          // Only extract errors that look like actual command failures, not source code
          // containing the word "error". Real Bash errors start with "Error: Exit code"
          // or have error patterns in the first 3 lines.
          const firstLines = content.split('\n').slice(0, 3).join('\n')
          const isBashError = /^Error: Exit code \d|^error[:\s]/im.test(firstLines) ||
            /FAILED|ENOENT|EACCES|ERR!/i.test(firstLines)

          if (isBashError) {
            const errorLine = content.split('\n').find(l => {
              const t = l.trim()
              if (t.length < 15) return false
              // Must look like a real error output, not source code displayed by Read tool.
              // Language-agnostic: reject line-numbered source code (cat -n format)
              if (/^\d+[\t|]/.test(t)) return false
              // Require error-like prefix patterns that appear in actual CLI/compiler output
              return /^(error|Error|ERROR|FAIL|FATAL|ERR!|warning:|panic|exception)/i.test(t) ||
                /:\s*(error|Error|FAIL|fatal)\b/.test(t) ||
                /^(npm|cargo|go|python|ruby|java|dotnet|gradle|maven)\s+ERR/i.test(t) ||
                /^E\d{4}:/.test(t) || // Python-style error codes
                /^error\[E\d+\]/.test(t) // Rust-style error codes
            })
            if (errorLine) {
              errorsHit.set(errorLine.trim().slice(0, 100), turnNumber)
            }
          }
          // Detect error fix: success after previous error on same command
          if (lastErrorCommand && !isBashError && content.length > 0) {
            const prevError = [...errorsHit.keys()].find(e =>
              lastErrorCommand && e.toLowerCase().includes(lastErrorCommand.split(/\s+/)[0].toLowerCase())
            )
            if (prevError) errorsFixed.add(prevError)
          }
        }
      }

      // User preferences and corrections
      if (!r.isMeta) {
        const text = extractTextContent(r)
        if (text) {
          const prefPatterns = [
            /don'?t\s+(?:add|use|include|create|make|put|write)\s+(.{10,80})/i,
            /(?:please\s+)?(?:stop|avoid|skip|remove)\s+(.{10,80})/i,
            /(?:I\s+(?:don't\s+)?(?:want|like|prefer|need))\s+(.{10,80})/i,
            /(?:never|always)\s+(.{10,80})/i,
          ]
          for (const pat of prefPatterns) {
            const m = text.match(pat)
            if (m) userPreferences.add(m[0].slice(0, 100))
          }
        }
      }
    }
  }

  // Build weighted fact list
  // Weights reflect Tang et al.'s findings on what gets lost most
  for (const f of filesModified) {
    facts.push({ category: 'file_modified', value: f, weight: 0.9, turn: 0 })
  }
  for (const f of filesRead) {
    if (!filesModified.has(f)) {
      facts.push({ category: 'file_read', value: f, weight: 0.3, turn: 0 })
    }
  }
  for (const [e, turn] of errorsHit) {
    facts.push({ category: 'error_hit', value: e, weight: 0.7, turn })
  }
  for (const e of errorsFixed) {
    facts.push({ category: 'error_fixed', value: e, weight: 0.9, turn: 0 })
  }
  for (const c of commits) {
    facts.push({ category: 'commit', value: c, weight: 0.8, turn: 0 })
  }
  for (const { cmd, turn } of keyCommands) {
    facts.push({ category: 'command_run', value: cmd, weight: 0.4, turn })
  }
  // Highest weight categories — most commonly lost per research
  for (const p of userPreferences) {
    facts.push({ category: 'user_preference', value: p, weight: 1.0, turn: 0 })
  }
  for (const a of approachesRejected) {
    facts.push({ category: 'approach_rejected', value: a, weight: 1.0, turn: 0 })
  }
  for (const c of conditionals) {
    facts.push({ category: 'conditional', value: c, weight: 0.9, turn: 0 })
  }

  // Temporal sequence — record order of key commands
  if (keyCommands.length >= 2) {
    const seq = keyCommands.map(c => c.cmd.split(/\s+/).slice(0, 3).join(' ')).join(' → ')
    facts.push({ category: 'temporal_sequence', value: seq, weight: 0.7, turn: 0 })
  }

  return facts
}

// ─── Handoff Scoring ────────────────────────────────────────

/**
 * Score a handoff summary against the source transcript's facts.
 * Also detects knowledge overwriting and semantic drift
 * (Size-Fidelity Paradox, arxiv 2602.09789).
 */
export function scoreHandoff(facts: TranscriptFact[], summary: string): HandoffScore {
  const normalizedSummary = summary.toLowerCase()

  const categories: Record<string, { total: number; preserved: number }> = {}
  const lostFacts: TranscriptFact[] = []
  let totalWeight = 0
  let preservedWeight = 0

  for (const fact of facts) {
    if (!categories[fact.category]) {
      categories[fact.category] = { total: 0, preserved: 0 }
    }
    categories[fact.category].total++
    totalWeight += fact.weight

    const preserved = isFactPreserved(fact, normalizedSummary)
    if (preserved) {
      categories[fact.category].preserved++
      preservedWeight += fact.weight
    } else {
      lostFacts.push(fact)
    }
  }

  // Detect knowledge overwriting (fact present but altered)
  const overwriteDetections = detectKnowledgeOverwriting(facts, normalizedSummary)

  // Detect semantic drift (ordering/causality changed)
  const driftDetections = detectSemanticDrift(facts, normalizedSummary)

  return {
    totalFacts: facts.length,
    preservedFacts: facts.length - lostFacts.length,
    score: totalWeight > 0 ? preservedWeight / totalWeight : 1,
    categories,
    lostFacts,
    overwriteDetections,
    driftDetections,
  }
}

function isFactPreserved(fact: TranscriptFact, normalizedSummary: string): boolean {
  const value = fact.value.toLowerCase()

  if (normalizedSummary.includes(value)) return true

  if (fact.category === 'file_modified' || fact.category === 'file_read') {
    const filename = value.split('/').pop() || value
    if (filename.length > 3 && normalizedSummary.includes(filename)) return true
  }

  if (fact.category === 'error_hit' || fact.category === 'error_fixed') {
    const tokens = significantTokens(value)
    const matchCount = tokens.filter(t => normalizedSummary.includes(t)).length
    if (tokens.length > 0 && matchCount / tokens.length >= 0.5) return true
  }

  if (fact.category === 'commit') {
    const words = value.split(/\s+/).slice(0, 4).filter(w => w.length > 3)
    const matchCount = words.filter(w => normalizedSummary.includes(w)).length
    if (words.length > 0 && matchCount / words.length >= 0.6) return true
  }

  if (fact.category === 'command_run') {
    const cmdName = value.split(/\s+/).slice(0, 3).join(' ')
    if (normalizedSummary.includes(cmdName)) return true
  }

  if (fact.category === 'approach_rejected' || fact.category === 'user_preference' || fact.category === 'conditional') {
    const tokens = significantTokens(value)
    const matchCount = tokens.filter(t => normalizedSummary.includes(t)).length
    if (tokens.length > 0 && matchCount / tokens.length >= 0.4) return true
  }

  if (fact.category === 'temporal_sequence') {
    // Check if the commands appear in the summary in the same order
    const commands = value.split(' → ')
    let lastIdx = -1
    let inOrder = true
    for (const cmd of commands) {
      const idx = normalizedSummary.indexOf(cmd.toLowerCase())
      if (idx === -1) { inOrder = false; break }
      if (idx <= lastIdx) { inOrder = false; break }
      lastIdx = idx
    }
    return inOrder
  }

  return false
}

// ─── Knowledge Overwriting Detection ────────────────────────
// Size-Fidelity Paradox: the LLM replaces specific facts with "expected" versions

function detectKnowledgeOverwriting(
  facts: TranscriptFact[],
  normalizedSummary: string
): OverwriteDetection[] {
  const detections: OverwriteDetection[] = []

  // Only check categories where overwriting is meaningful
  const checkable = facts.filter(f =>
    f.category === 'error_hit' || f.category === 'error_fixed' || f.category === 'conditional'
  )

  for (const fact of checkable) {
    const tokens = significantTokens(fact.value)
    if (tokens.length < 3) continue // need enough tokens for meaningful comparison

    const matchCount = tokens.filter(t => normalizedSummary.includes(t)).length
    const ratio = matchCount / tokens.length

    // Partial match (30-49%) with 2+ matching tokens suggests overwriting
    if (ratio >= 0.3 && ratio < 0.5 && matchCount >= 2) {
      const firstMatch = tokens.find(t => normalizedSummary.includes(t))
      if (firstMatch) {
        const idx = normalizedSummary.indexOf(firstMatch)
        const context = normalizedSummary.slice(Math.max(0, idx - 30), idx + 50).trim()
        detections.push({
          originalFact: fact.value,
          summaryVersion: context,
          category: fact.category,
        })
      }
    }
  }

  return detections
}

// ─── Semantic Drift Detection ───────────────────────────────
// The LLM paraphrases and reorders, subtly changing meaning

function detectSemanticDrift(
  facts: TranscriptFact[],
  normalizedSummary: string
): DriftDetection[] {
  const detections: DriftDetection[] = []

  // Check temporal sequences for reordering
  const seqFacts = facts.filter(f => f.category === 'temporal_sequence')
  for (const seq of seqFacts) {
    const commands = seq.value.split(' → ').map(c => c.toLowerCase())
    if (commands.length < 2) continue

    // Find positions of each command in the summary
    const positions = commands.map(c => normalizedSummary.indexOf(c))
    const found = positions.filter(p => p !== -1)

    if (found.length >= 2) {
      // Check if they appear in a different order than the transcript
      let isReordered = false
      for (let i = 1; i < found.length; i++) {
        if (found[i] < found[i - 1]) {
          isReordered = true
          break
        }
      }
      if (isReordered) {
        const summaryOrder = commands
          .map((c, i) => ({ cmd: c, pos: positions[i] }))
          .filter(x => x.pos !== -1)
          .sort((a, b) => a.pos - b.pos)
          .map(x => x.cmd)

        detections.push({
          description: 'Command execution order changed in summary',
          originalOrder: commands,
          summaryOrder,
        })
      }
    }
  }

  return detections
}

// ─── New Session Signals ────────────────────────────────────

/**
 * Analyze a new session's transcript to detect information loss signals.
 * Includes user correction detection (LongMemEval-inspired).
 */
export function detectInformationLoss(
  oldFacts: TranscriptFact[],
  newTranscriptPath: string
): NewSessionSignals {
  const newFacts = extractFacts(newTranscriptPath)

  const oldFilesKnown = new Set(
    oldFacts.filter(f => f.category === 'file_read' || f.category === 'file_modified').map(f => f.value)
  )
  const newFilesRead = newFacts.filter(f => f.category === 'file_read').map(f => f.value)
  const redundantReads = newFilesRead.filter(f => oldFilesKnown.has(f))

  // Re-discovery turns
  let rediscoveryTurns = 0
  try {
    const lines = readFileSync(newTranscriptPath, 'utf-8').split('\n')
    for (const line of lines) {
      try {
        const r = JSON.parse(line)
        if (r.type === 'assistant' && r.message?.content) {
          const content = r.message.content as Array<Record<string, unknown>>
          const hasEdit = content.some(b => b.type === 'tool_use' && (b.name === 'Edit' || b.name === 'Write'))
          if (hasEdit) break
          if (content.some(b => b.type === 'tool_use')) rediscoveryTurns++
        }
      } catch {}
    }
  } catch {}

  // Error repetition
  const oldFixed = oldFacts.filter(f => f.category === 'error_fixed').map(f => f.value.toLowerCase())
  const newErrors = newFacts.filter(f => f.category === 'error_hit').map(f => f.value.toLowerCase())
  const repeatedErrors = newErrors.filter(ne =>
    oldFixed.some(oe => tokenOverlap(oe, ne) >= 0.5)
  )

  // User corrections — detect phrases indicating the handoff lost something
  const userCorrections: string[] = []
  try {
    const lines = readFileSync(newTranscriptPath, 'utf-8').split('\n')
    for (const line of lines) {
      try {
        const r = JSON.parse(line)
        if (r.type === 'user' && !r.isMeta) {
          const text = extractTextContent(r)
          if (!text) continue
          const correctionPatterns = [
            /I\s+(?:already|just)\s+(?:told|said|mentioned|explained)/i,
            /(?:we|I)\s+(?:already|just)\s+(?:tried|did|fixed|discussed)/i,
            /(?:as\s+I\s+(?:said|mentioned)|like\s+I\s+said)/i,
            /(?:no,?\s+)?(?:that's\s+not|that\s+isn't)\s+(?:what|how|right)/i,
            /(?:remember|recall)\s+(?:that|when|how)/i,
          ]
          for (const pat of correctionPatterns) {
            const m = text.match(pat)
            if (m) {
              userCorrections.push(text.slice(0, 100))
              break
            }
          }
        }
      } catch {}
    }
  } catch {}

  return { redundantReads, rediscoveryTurns, repeatedErrors, userCorrections }
}

// ─── Report Generation ──────────────────────────────────────

// ANSI color helpers
const c = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
}

function scoreColor(pct: number): (s: string) => string {
  if (pct >= 70) return c.green
  if (pct >= 40) return c.yellow
  return c.red
}

function bar(preserved: number, total: number, width = 20): string {
  if (total === 0) return c.dim('─'.repeat(width))
  const filled = Math.round((preserved / total) * width)
  const empty = width - filled
  const pct = Math.round((preserved / total) * 100)
  const colorFn = scoreColor(pct)
  return colorFn('█'.repeat(filled)) + c.dim('░'.repeat(empty))
}

export function generateReport(score: HandoffScore, signals?: NewSessionSignals): string {
  const pct = Math.round(score.score * 100)
  const colorFn = scoreColor(pct)
  const lines: string[] = []

  lines.push(`  Handoff Quality`)
  lines.push(`  ${'─'.repeat(52)}`)
  lines.push(``)
  lines.push(`  Score:  ${colorFn(`${pct}%`)} ${c.dim(`(${score.preservedFacts}/${score.totalFacts} facts preserved)`)}`)
  lines.push(``)

  // Category breakdown table
  const categoryLabels: Record<string, string> = {
    user_preference: 'Preferences',
    approach_rejected: 'Rejected approaches',
    conditional: 'Conditionals',
    file_modified: 'Files modified',
    error_fixed: 'Errors fixed',
    error_hit: 'Errors hit',
    commit: 'Commits',
    temporal_sequence: 'Execution order',
    command_run: 'Commands',
    file_read: 'Files read',
  }

  const categoryOrder: FactCategory[] = [
    'file_modified', 'commit', 'file_read', 'command_run',
    'error_hit', 'error_fixed',
    'user_preference', 'approach_rejected', 'conditional',
    'temporal_sequence',
  ]

  for (const cat of categoryOrder) {
    const data = score.categories[cat]
    if (!data) continue
    const label = (categoryLabels[cat] || cat).padEnd(20)
    const ratio = `${data.preserved}/${data.total}`.padStart(5)
    lines.push(`  ${label} ${ratio}  ${bar(data.preserved, data.total)}`)
  }

  // Warnings
  if (score.driftDetections.length > 0) {
    lines.push(``)
    lines.push(`  ${c.yellow('⚠')} Semantic drift — execution order changed in summary`)
  }

  if (score.overwriteDetections.length > 0) {
    lines.push(`  ${c.yellow('⚠')} Knowledge overwriting — ${score.overwriteDetections.length} fact(s) altered`)
  }

  // Key losses (only high-weight)
  const criticalLosses = score.lostFacts
    .filter(f => f.weight >= 0.8)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)

  if (criticalLosses.length > 0) {
    lines.push(``)
    lines.push(`  ${c.bold('Lost')} ${c.dim('(high-importance facts not in handoff)')}`)
    for (const f of criticalLosses) {
      const label = (categoryLabels[f.category] || f.category).slice(0, 12)
      lines.push(`  ${c.dim(label.padEnd(13))} ${f.value.slice(0, 55)}`)
    }
  }

  // New session impact signals
  if (signals) {
    const hasImpact = signals.redundantReads.length > 0 ||
      signals.rediscoveryTurns > 0 ||
      signals.repeatedErrors.length > 0 ||
      signals.userCorrections.length > 0

    if (hasImpact) {
      lines.push(``)
      lines.push(`  ${c.bold('Impact on next session')}`)
      if (signals.redundantReads.length > 0) {
        lines.push(`  ${c.dim('Redundant reads:')}  ${signals.redundantReads.length} files re-read`)
      }
      if (signals.rediscoveryTurns > 0) {
        lines.push(`  ${c.dim('Re-discovery:')}     ${signals.rediscoveryTurns} turns before first edit`)
      }
      if (signals.repeatedErrors.length > 0) {
        lines.push(`  ${c.red('Repeated errors:')} ${signals.repeatedErrors.length} already-fixed errors hit again`)
      }
      if (signals.userCorrections.length > 0) {
        lines.push(`  ${c.yellow('Corrections:')}     ${signals.userCorrections.length} times user said "I already told you..."`)
      }
    }
  }

  lines.push(``)
  return lines.join('\n')
}

// ─── Helpers ────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'error', 'failed', 'cannot', 'could', 'would', 'should', 'the', 'and',
  'for', 'with', 'from', 'that', 'this', 'not', 'was', 'were', 'has',
  'have', 'been', 'will', 'exit', 'code',
])

function significantTokens(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(t => t.length > 3 && !STOP_WORDS.has(t))
}

function tokenOverlap(a: string, b: string): number {
  const tokensA = significantTokens(a)
  const tokensB = significantTokens(b)
  if (tokensA.length === 0) return 0
  const matches = tokensA.filter(t => tokensB.includes(t)).length
  return matches / tokensA.length
}

function normalizeForComparison(filepath: string): string {
  return filepath
    .replace(/^\/(?:Users|home)\/[^/]+\/(?:.*?\/)?(?=src\/|lib\/|app\/|pages\/|components\/|public\/|test\/|tests\/)/, '')
    .split('/').pop() || filepath
}

function extractTextContent(record: Record<string, unknown>): string | null {
  const msg = record.message as { content?: unknown } | undefined
  if (!msg?.content) return null
  if (typeof msg.content === 'string') return msg.content
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b: Record<string, unknown>) => b.type === 'text' && typeof b.text === 'string')
      .map((b: Record<string, unknown>) => b.text as string)
      .join('\n')
  }
  return null
}
