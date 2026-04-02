import type { BashFilterConfig } from '../types.js'

export interface CompressionResult {
  compressed: boolean
  original: string
  output: string
  originalLength: number
  compressedLength: number
}

const DEFAULT_PRESERVE = ['error', 'warn', 'fail', 'exception', '✗']
const DEFAULT_NOISE = ['npm warn', 'added \\d+ packages', '\\[=+']

/**
 * Compress verbose bash output to reduce token usage.
 *
 * Rules applied in order:
 * 1. Short output (< 500 chars) passes through unchanged
 * 2. Detect and compress noisy output types:
 *    - npm/pnpm/yarn install logs
 *    - Progress bars
 *    - Repeated identical lines
 *    - Build progress (keep only error/warn/success lines)
 */
export function compressBashOutput(
  output: string,
  config?: Partial<BashFilterConfig>
): CompressionResult {
  const maxChars = config?.maxOutputChars ?? 2000
  const preservePatterns = (config?.preservePatterns ?? DEFAULT_PRESERVE).map(
    (p) => new RegExp(p, 'i')
  )

  if (output.length < 500) {
    return {
      compressed: false,
      original: output,
      output,
      originalLength: output.length,
      compressedLength: output.length,
    }
  }

  let result = output
  const lines = result.split('\n')

  // Remove progress bar lines
  const filteredLines = lines.filter(
    (line) => !/\[=+[>\s]*\]/.test(line) && !/[█░▓▒]{3,}/.test(line)
  )

  // Collapse repeated identical lines
  const collapsed = collapseRepeatedLines(filteredLines)

  // Detect npm/yarn/pnpm install output and summarize
  if (isPackageManagerOutput(output)) {
    result = summarizePackageManagerOutput(collapsed)
  } else {
    // For build output, keep important lines + head/tail
    const importantLines = collapsed.filter((line) =>
      preservePatterns.some((p) => p.test(line))
    )

    if (importantLines.length > 0 && importantLines.length < collapsed.length * 0.5) {
      // Mostly noise — keep important lines plus context
      const head = collapsed.slice(0, 5)
      const tail = collapsed.slice(-5)
      result = [
        ...head,
        `\n[... ${collapsed.length - 10} lines omitted, ${importantLines.length} important lines below ...]\n`,
        ...importantLines,
        '\n[... end of important lines ...]\n',
        ...tail,
      ].join('\n')
    } else {
      result = collapsed.join('\n')
    }
  }

  // Final truncation if still too long
  if (result.length > maxChars) {
    const headSize = Math.floor(maxChars * 0.4)
    const tailSize = Math.floor(maxChars * 0.4)
    result =
      result.slice(0, headSize) +
      `\n\n[... truncated ${result.length - headSize - tailSize} chars ...]\n\n` +
      result.slice(-tailSize)
  }

  const compressed = result.length < output.length
  if (compressed) {
    result += `\n[clauditor: output compressed from ${formatSize(output.length)} → ${formatSize(result.length)}]`
  }

  return {
    compressed,
    original: output,
    output: compressed ? result : output,
    originalLength: output.length,
    compressedLength: result.length,
  }
}

function collapseRepeatedLines(lines: string[]): string[] {
  const result: string[] = []
  let lastLine = ''
  let repeatCount = 0

  for (const line of lines) {
    if (line === lastLine) {
      repeatCount++
    } else {
      if (repeatCount > 1) {
        result.push(`[previous line repeated ${repeatCount} times]`)
      }
      result.push(line)
      lastLine = line
      repeatCount = 1
    }
  }

  if (repeatCount > 1) {
    result.push(`[previous line repeated ${repeatCount} times]`)
  }

  return result
}

function isPackageManagerOutput(output: string): boolean {
  return /^(npm|pnpm|yarn)\s+(install|add|i)\b/m.test(output) ||
    /added \d+ packages?/i.test(output) ||
    /packages? are looking for funding/i.test(output)
}

function summarizePackageManagerOutput(lines: string[]): string {
  const head = lines.slice(0, 5)
  const tail = lines.slice(-5)
  const addedMatch = lines.join('\n').match(/added (\d+) packages?/i)
  const vulnMatch = lines.join('\n').match(/(\d+) vulnerabilit/i)

  const summary = [
    ...head,
    '',
    `[... ${lines.length - 10} lines of package manager output omitted ...]`,
    '',
  ]

  if (addedMatch) summary.push(`Summary: ${addedMatch[0]}`)
  if (vulnMatch) summary.push(`Vulnerabilities: ${vulnMatch[0]}`)
  if (!addedMatch && !vulnMatch) summary.push('(install output summarized)')

  summary.push('', ...tail)
  return summary.join('\n')
}

function formatSize(chars: number): string {
  if (chars < 1000) return `${chars} chars`
  return `${(chars / 1000).toFixed(1)}k chars`
}
