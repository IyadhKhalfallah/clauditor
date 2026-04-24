import { compressBashOutput, type CompressionResult } from './bash-filter.js'
import { isTurbo, TURBO_THRESHOLDS } from '../config.js'

/**
 * Generic output compressor. Dispatches to a per-tool strategy based on
 * which tool produced the output.
 *
 * Bash already had its own compressor; this file adds coverage for the
 * other verbose tools (Grep, Glob, WebFetch, WebSearch). Each strategy
 * keeps the signal (matches, URLs, error lines) and trims the noise
 * (repeated context lines, deep path counts, marketing HTML).
 *
 * Read is intentionally NOT handled here. Post-hoc compression of a Read
 * result only rewrites what Claude sees in the NEXT turn; the bytes are
 * already in the transcript. Reducing Read cost requires a PreToolUse
 * rewrite that injects `offset`/`limit`, which is a separate change.
 */

export interface ToolOutputInput {
  toolName: string
  output: string
  toolInput?: Record<string, unknown>
}

export function compressToolOutput(input: ToolOutputInput): CompressionResult {
  const { toolName, output, toolInput } = input

  switch (toolName) {
    case 'Bash':
      return compressBashOutput(output)
    case 'Grep':
      return compressGrepOutput(output, toolInput)
    case 'Glob':
      return compressGlobOutput(output)
    case 'WebFetch':
      return compressWebFetchOutput(output)
    case 'WebSearch':
      return compressWebSearchOutput(output)
    default:
      return passthrough(output)
  }
}

function passthrough(output: string): CompressionResult {
  return {
    compressed: false,
    original: output,
    output,
    originalLength: output.length,
    compressedLength: output.length,
  }
}

// ─── Grep ────────────────────────────────────────────────────
//
// Grep in "content" mode returns matching lines, often hundreds of them.
// Strategy: keep the first 40 matches and last 10 matches intact, then
// summarize the middle as a file+count rollup so Claude still sees which
// files have matches it didn't see.

const GREP_MATCH_LINE = /^([^:]+):(\d+):/

export function compressGrepOutput(
  output: string,
  toolInput?: Record<string, unknown>
): CompressionResult {
  // Only compress content-mode output. files_with_matches and count modes
  // return one line per file (cheap) and are already compact.
  const mode = toolInput?.output_mode
  if (mode && mode !== 'content') return passthrough(output)

  if (output.length < 800) return passthrough(output)

  const lines = output.split('\n')
  const matchLines = lines.filter((l) => GREP_MATCH_LINE.test(l))

  const minMatches = isTurbo() ? TURBO_THRESHOLDS.grepRollupMinMatches : 60
  if (matchLines.length < minMatches) return passthrough(output)

  const head = matchLines.slice(0, 40)
  const tail = matchLines.slice(-10)
  const middle = matchLines.slice(40, -10)

  // Rollup the middle by file
  const byFile = new Map<string, number>()
  for (const line of middle) {
    const m = line.match(GREP_MATCH_LINE)
    if (m) byFile.set(m[1], (byFile.get(m[1]) || 0) + 1)
  }
  const rollup = Array.from(byFile.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([file, count]) => `  ${file}: ${count} matches`)
    .join('\n')

  const result = [
    ...head,
    '',
    `[clauditor: ${middle.length} additional matches across ${byFile.size} files omitted. Top files:`,
    rollup,
    `]`,
    '',
    ...tail,
  ].join('\n')

  return {
    compressed: true,
    original: output,
    output: result,
    originalLength: output.length,
    compressedLength: result.length,
  }
}

// ─── Glob ────────────────────────────────────────────────────
//
// Glob returns one file path per line. On wide patterns this can be
// hundreds of paths. Group by directory and keep the first 50 paths
// verbatim; summarize the rest with directory rollups.

export function compressGlobOutput(output: string): CompressionResult {
  if (output.length < 1500) return passthrough(output)

  const paths = output.split('\n').filter((l) => l.trim().length > 0)
  const minPaths = isTurbo() ? TURBO_THRESHOLDS.globRollupMinPaths : 60
  if (paths.length < minPaths) return passthrough(output)

  const head = paths.slice(0, 50)
  const rest = paths.slice(50)

  const byDir = new Map<string, number>()
  for (const p of rest) {
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.'
    byDir.set(dir, (byDir.get(dir) || 0) + 1)
  }

  const rollup = Array.from(byDir.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([dir, count]) => `  ${dir}/: ${count} files`)
    .join('\n')

  const result = [
    ...head,
    '',
    `[clauditor: ${rest.length} additional paths across ${byDir.size} directories omitted. Top directories:`,
    rollup,
    `]`,
  ].join('\n')

  return {
    compressed: true,
    original: output,
    output: result,
    originalLength: output.length,
    compressedLength: result.length,
  }
}

// ─── WebFetch ────────────────────────────────────────────────
//
// WebFetch already runs its content through a small-model summarization
// step internally, but the returned text is not size-bounded. Cap at
// 4,000 chars; preserve headers and code blocks in the first portion.

const WEB_MAX_DEFAULT = 4000

export function compressWebFetchOutput(output: string): CompressionResult {
  const max = isTurbo() ? TURBO_THRESHOLDS.webFetchMaxChars : WEB_MAX_DEFAULT
  if (output.length <= max) return passthrough(output)

  const head = output.slice(0, Math.floor(max * 0.75))
  const tail = output.slice(-Math.floor(max * 0.15))
  const omitted = output.length - head.length - tail.length

  const result =
    head +
    `\n\n[clauditor: ${omitted} chars of fetched content omitted. If the answer needs the rest, fetch again with a narrower prompt.]\n\n` +
    tail

  return {
    compressed: true,
    original: output,
    output: result,
    originalLength: output.length,
    compressedLength: result.length,
  }
}

// ─── WebSearch ───────────────────────────────────────────────
//
// WebSearch returns structured results (title, URL, description).
// Descriptions can be long marketing text. Cap descriptions at 200 chars
// each; keep URLs and titles intact so Claude can follow up with WebFetch
// if needed.

export function compressWebSearchOutput(output: string): CompressionResult {
  if (output.length < 2000) return passthrough(output)

  // Conservative approach: truncate paragraphs to ~200 chars each (or ~120
  // in turbo mode). WebSearch output format varies; this avoids parsing
  // structurally. URLs and bracketed tokens are preserved unconditionally.
  const cap = isTurbo() ? TURBO_THRESHOLDS.webSearchLineCap : 220
  const keepInside = Math.max(60, cap - 20)
  const lines = output.split('\n')
  let changed = false
  const trimmed = lines.map((line) => {
    if (line.length > cap && !line.startsWith('http') && !line.startsWith('[')) {
      changed = true
      return line.slice(0, keepInside) + '... [clauditor: trimmed]'
    }
    return line
  })

  if (!changed) return passthrough(output)

  const result = trimmed.join('\n')
  return {
    compressed: result.length < output.length,
    original: output,
    output: result,
    originalLength: output.length,
    compressedLength: result.length,
  }
}
