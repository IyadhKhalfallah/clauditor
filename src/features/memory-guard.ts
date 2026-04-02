import { readFile, access } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'

export interface MemoryFileAudit {
  path: string
  exists: boolean
  content: string
  tokens: number
  entries: MemoryEntry[]
  oversizedEntries: MemoryEntry[]
}

export interface MemoryEntry {
  line: number
  content: string
  charCount: number
  isLikelyInlineData: boolean
}

export interface MemoryAuditResult {
  files: MemoryFileAudit[]
  totalTokens: number
  costPerMessageCached: number
  costPerMessageUncached: number
  hasOversizedFiles: boolean
}

/**
 * Estimate token count from character count.
 * Uses a conservative 4 chars per token heuristic.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Audit all CLAUDE.md files in the hierarchy.
 */
export async function auditMemoryFiles(
  projectPath: string,
  tokenWarningThreshold: number = 4000
): Promise<MemoryAuditResult> {
  const home = homedir()

  const filesToCheck = [
    { path: '/etc/claude-code/CLAUDE.md', label: '/etc/claude-code/CLAUDE.md' },
    { path: resolve(home, '.claude/CLAUDE.md'), label: '~/.claude/CLAUDE.md' },
    { path: resolve(projectPath, 'CLAUDE.md'), label: './CLAUDE.md' },
    { path: resolve(projectPath, 'CLAUDE.local.md'), label: './CLAUDE.local.md' },
  ]

  const files: MemoryFileAudit[] = []

  for (const { path, label } of filesToCheck) {
    const audit = await auditSingleFile(path)
    files.push(audit)
  }

  // Scan .claude/rules/ directory
  const rulesDir = resolve(projectPath, '.claude/rules')
  try {
    const ruleFiles = await readdir(rulesDir)
    for (const ruleFile of ruleFiles) {
      if (ruleFile.endsWith('.md')) {
        const rulePath = join(rulesDir, ruleFile)
        const audit = await auditSingleFile(rulePath)
        files.push(audit)
      }
    }
  } catch {
    // Rules directory may not exist
  }

  const totalTokens = files.reduce((sum, f) => sum + f.tokens, 0)

  // Cost per message: tokens * price per token
  // Cache read: $0.30/1M, Uncached: $3.00/1M (Sonnet pricing)
  const costPerMessageCached = (totalTokens / 1_000_000) * 0.3
  const costPerMessageUncached = (totalTokens / 1_000_000) * 3.0

  const hasOversizedFiles = files.some(
    (f) => f.exists && f.tokens > tokenWarningThreshold
  )

  return {
    files,
    totalTokens,
    costPerMessageCached,
    costPerMessageUncached,
    hasOversizedFiles,
  }
}

async function auditSingleFile(filePath: string): Promise<MemoryFileAudit> {
  try {
    await access(filePath)
    const content = await readFile(filePath, 'utf-8')
    const tokens = estimateTokens(content)
    const entries = parseEntries(content)
    const oversizedEntries = entries.filter((e) => e.isLikelyInlineData)

    return {
      path: filePath,
      exists: true,
      content,
      tokens,
      entries,
      oversizedEntries,
    }
  } catch {
    return {
      path: filePath,
      exists: false,
      content: '',
      tokens: 0,
      entries: [],
      oversizedEntries: [],
    }
  }
}

/**
 * Parse entries from a CLAUDE.md file.
 * An "entry" is a non-empty line or block of content.
 * Entries > 150 chars are flagged as likely inline data.
 */
function parseEntries(content: string): MemoryEntry[] {
  const lines = content.split('\n')
  const entries: MemoryEntry[] = []
  let currentEntry = ''
  let startLine = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') {
      if (currentEntry.trim()) {
        entries.push({
          line: startLine + 1,
          content: currentEntry.trim(),
          charCount: currentEntry.trim().length,
          isLikelyInlineData: currentEntry.trim().length > 150,
        })
      }
      currentEntry = ''
      startLine = i + 1
    } else {
      if (!currentEntry) startLine = i
      currentEntry += (currentEntry ? '\n' : '') + line
    }
  }

  if (currentEntry.trim()) {
    entries.push({
      line: startLine + 1,
      content: currentEntry.trim(),
      charCount: currentEntry.trim().length,
      isLikelyInlineData: currentEntry.trim().length > 150,
    })
  }

  return entries
}

/**
 * Format the audit result for terminal output.
 */
export function formatAuditResult(
  result: MemoryAuditResult,
  projectPath: string
): string {
  const lines: string[] = []

  lines.push(`CLAUDE.md audit for ${projectPath}`)
  lines.push('─'.repeat(50))

  const existingFiles = result.files.filter((f) => f.exists)

  if (existingFiles.length === 0) {
    lines.push('')
    lines.push('  No CLAUDE.md files found in the hierarchy.')
    lines.push('  Checked:')
    for (const file of result.files) {
      lines.push(`    ${file.path}`)
    }
    lines.push('')
    lines.push('  Tip: Create a CLAUDE.md in your project root to give Claude')
    lines.push('  persistent context about your codebase, conventions, and preferences.')
    return lines.join('\n')
  }

  for (const file of existingFiles) {

    const status = file.tokens > 4000 ? '⚠ oversized' : '✓ ok'
    lines.push(`  ${file.path}  ${file.tokens.toLocaleString()} tokens  ${status}`)

    if (file.oversizedEntries.length > 0) {
      lines.push(
        `    └─ ${file.oversizedEntries.length} entries > 150 chars (likely inline data, not pointers)`
      )
      lines.push(
        `       Suggestion: move to .claude/topics/ and reference by pointer`
      )
    }
  }

  lines.push('')
  lines.push(`  Total footprint: ${result.totalTokens.toLocaleString()} tokens`)
  lines.push(
    `  Cost per message (cache read):  $${result.costPerMessageCached.toFixed(4)}`
  )
  lines.push(
    `  Cost per message (uncached):    $${result.costPerMessageUncached.toFixed(4)}`
  )

  const dailyCached = result.costPerMessageCached * 100
  const dailyUncached = result.costPerMessageUncached * 100
  lines.push(
    `  At 100 msgs/day:  $${dailyCached.toFixed(2)}/day cached | $${dailyUncached.toFixed(2)}/day uncached`
  )

  if (result.hasOversizedFiles) {
    lines.push('')
    lines.push('─'.repeat(50))
    lines.push('Recommendation: Refactor oversized CLAUDE.md to use the 3-layer pattern:')
    lines.push('  MEMORY.md  → index of pointers only (~150 chars/entry)')
    lines.push('  .claude/topics/<topic>.md → actual content, fetched on demand')
  }

  return lines.join('\n')
}
