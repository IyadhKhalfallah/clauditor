import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  detectTool,
  pathForTool,
  hasInstruction,
  writeInstruction,
  INSTRUCTION_BLOCK,
} from './init-instruction.js'

const TMP = '/tmp/test-clauditor-init'

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('detectTool', () => {
  it('detects claude_code from CLAUDE.md', () => {
    writeFileSync(resolve(TMP, 'CLAUDE.md'), 'hello')
    expect(detectTool(TMP)).toBe('claude_code')
  })
  it('detects codex from AGENTS.md', () => {
    writeFileSync(resolve(TMP, 'AGENTS.md'), 'hello')
    expect(detectTool(TMP)).toBe('codex')
  })
  it('detects cursor from .cursor/rules', () => {
    mkdirSync(resolve(TMP, '.cursor/rules'), { recursive: true })
    expect(detectTool(TMP)).toBe('cursor')
  })
  it('detects cursor from .cursorrules', () => {
    writeFileSync(resolve(TMP, '.cursorrules'), 'hello')
    expect(detectTool(TMP)).toBe('cursor')
  })
  it('returns null when nothing matches', () => {
    expect(detectTool(TMP)).toBe(null)
  })
})

describe('pathForTool', () => {
  it('returns null for claude_desktop + other', () => {
    expect(pathForTool('claude_desktop')).toBe(null)
    expect(pathForTool('other')).toBe(null)
  })
  it('returns the right relative path for supported tools', () => {
    expect(pathForTool('claude_code')).toBe('CLAUDE.md')
    expect(pathForTool('codex')).toBe('AGENTS.md')
    expect(pathForTool('cursor')).toBe('.cursor/rules/clauditor.mdc')
  })
})

describe('hasInstruction', () => {
  it('detects clauditor_research mention', () => {
    expect(hasInstruction('something clauditor_research something')).toBe(true)
  })
  it('returns false for unrelated content', () => {
    expect(hasInstruction('# My project\nTyped with TypeScript')).toBe(false)
  })
})

describe('writeInstruction', () => {
  it('creates the file when missing', () => {
    const r = writeInstruction(TMP, 'claude_code')
    expect(r).toEqual({ status: 'written', path: 'CLAUDE.md', created: true })
    expect(readFileSync(resolve(TMP, 'CLAUDE.md'), 'utf-8')).toBe(INSTRUCTION_BLOCK)
  })

  it('appends to an existing file non-destructively', () => {
    writeFileSync(resolve(TMP, 'CLAUDE.md'), '# Existing\n\nContent here.\n')
    const r = writeInstruction(TMP, 'claude_code')
    expect(r.status).toBe('written')
    const content = readFileSync(resolve(TMP, 'CLAUDE.md'), 'utf-8')
    expect(content).toContain('# Existing')
    expect(content).toContain('Content here.')
    expect(content).toContain(INSTRUCTION_BLOCK.trim())
  })

  it('skips if already present', () => {
    writeFileSync(resolve(TMP, 'CLAUDE.md'), '# Existing\n\nWe use clauditor_research a lot.\n')
    const before = readFileSync(resolve(TMP, 'CLAUDE.md'), 'utf-8')
    const r = writeInstruction(TMP, 'claude_code')
    expect(r.status).toBe('already_present')
    expect(readFileSync(resolve(TMP, 'CLAUDE.md'), 'utf-8')).toBe(before)
  })

  it('creates nested directories for cursor path', () => {
    const r = writeInstruction(TMP, 'cursor')
    expect(r.status).toBe('written')
    expect(existsSync(resolve(TMP, '.cursor/rules/clauditor.mdc'))).toBe(true)
  })

  it('returns manual_required for claude_desktop', () => {
    expect(writeInstruction(TMP, 'claude_desktop')).toEqual({ status: 'manual_required', tool: 'claude_desktop' })
  })
})
