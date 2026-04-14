import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

export type AiTool = 'claude_code' | 'codex' | 'cursor' | 'claude_desktop' | 'other'

export const INSTRUCTION_HEADER = '## Knowledge'

export const INSTRUCTION_BODY = `Before answering questions or writing code, check Clauditor's team knowledge via its MCP tools (clauditor_research, clauditor_get_brief, clauditor_get_gotchas, clauditor_who_knows). If you learn something new during this session, save it with clauditor_save_learning.`

export const INSTRUCTION_BLOCK = `${INSTRUCTION_HEADER}\n${INSTRUCTION_BODY}\n`

export interface ToolTarget {
  tool: AiTool
  /** Relative path the instruction lives in. null for claude_desktop. */
  path: string | null
  /** Human-readable description of where it went. */
  description: string
}

const TOOL_PATHS: Record<Exclude<AiTool, 'claude_desktop' | 'other'>, string> = {
  claude_code: 'CLAUDE.md',
  codex: 'AGENTS.md',
  cursor: '.cursor/rules/clauditor.mdc',
}

/**
 * Detect which AI tool the repo is set up for by looking for config files.
 * Returns the first match; null if none found.
 */
export function detectTool(cwd: string): AiTool | null {
  if (existsSync(resolve(cwd, 'CLAUDE.md'))) return 'claude_code'
  if (existsSync(resolve(cwd, 'AGENTS.md'))) return 'codex'
  if (existsSync(resolve(cwd, '.cursor/rules')) || existsSync(resolve(cwd, '.cursorrules'))) return 'cursor'
  return null
}

export function pathForTool(tool: AiTool): string | null {
  if (tool === 'claude_desktop' || tool === 'other') return null
  return TOOL_PATHS[tool]
}

/**
 * Returns true if the file already contains a clauditor knowledge block
 * we shouldn't duplicate. We match on the literal mention of
 * `clauditor_research` or `Clauditor's team knowledge` — either signals
 * the block (or a user-edited variant of it) is already present.
 */
export function hasInstruction(content: string): boolean {
  return content.includes('clauditor_research') || content.includes("Clauditor's team knowledge")
}

export type WriteResult =
  | { status: 'written'; path: string; created: boolean }
  | { status: 'already_present'; path: string }
  | { status: 'manual_required'; tool: AiTool }

/**
 * Append the `## Knowledge` block to the appropriate file for `tool`.
 *
 * Non-destructive: if the file exists, we APPEND. If a clauditor block is
 * already present (detected via `hasInstruction`), we return
 * `already_present` and touch nothing.
 *
 * For tools without a per-project config file (claude_desktop, other) we
 * return `manual_required` so the caller can print paste instructions.
 */
export function writeInstruction(cwd: string, tool: AiTool): WriteResult {
  const relPath = pathForTool(tool)
  if (!relPath) return { status: 'manual_required', tool }

  const filePath = resolve(cwd, relPath)
  const exists = existsSync(filePath)

  if (exists) {
    const current = readFileSync(filePath, 'utf-8')
    if (hasInstruction(current)) {
      return { status: 'already_present', path: relPath }
    }
    const sep = current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n'
    writeFileSync(filePath, current + sep + INSTRUCTION_BLOCK)
    return { status: 'written', path: relPath, created: false }
  }

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, INSTRUCTION_BLOCK)
  return { status: 'written', path: relPath, created: true }
}

/**
 * Notify the hub that the instruction has been written. Best-effort —
 * older hub versions won't have this endpoint, which is fine; the user
 * can still click "I've added it" in the dashboard.
 */
export async function notifyHub(hubUrl: string, apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${hubUrl}/api/v1/setup/instruction-confirm`, {
      method: 'POST',
      headers: { 'X-Clauditor-Key': apiKey },
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}
