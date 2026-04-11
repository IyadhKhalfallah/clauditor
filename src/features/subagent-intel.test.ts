import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import {
  classifySubagent,
  scanSubagents,
  scanSessionSubagents,
  detectPatterns,
  type SubagentSignal,
} from './subagent-intel.js'

// ─── classifySubagent ──────────────────────────────────────

describe('classifySubagent', () => {
  it('classifies fix-related descriptions', () => {
    expect(classifySubagent('Fix post-merge build errors')).toBe('fix')
    expect(classifySubagent('Resolve merge conflicts')).toBe('fix')
    expect(classifySubagent('Resolve test file merge conflicts')).toBe('fix')
    expect(classifySubagent('Fix remaining 9 Copilot comments')).toBe('fix')
    expect(classifySubagent('Fix tests missing VariableAgentRunner')).toBe('fix')
  })

  it('classifies query/search descriptions', () => {
    expect(classifySubagent('Query App Insights for undefined file types')).toBe('query')
    expect(classifySubagent('Search codebase for file assertion types')).toBe('query')
    expect(classifySubagent('Search DB scripts for file type schema')).toBe('query')
  })

  it('classifies research/investigation descriptions', () => {
    expect(classifySubagent('Research industry page stability benchmarks')).toBe('research')
    expect(classifySubagent('Investigate Redis timeout issue')).toBe('research')
    expect(classifySubagent('Explore Thunders browser automation')).toBe('research')
    expect(classifySubagent('How multi-app variables work')).toBe('research')
  })

  it('classifies find/trace descriptions', () => {
    expect(classifySubagent('Find Selector.Invalid logic')).toBe('find')
    expect(classifySubagent('Trace StepsToActions pipeline flow')).toBe('find')
    expect(classifySubagent('Find existing DeterministicSelector tests')).toBe('find')
  })

  it('classifies check/verify descriptions', () => {
    expect(classifySubagent('Check DeterministicSelector validation bug')).toBe('check')
    expect(classifySubagent('Verify and resolve Copilot comments')).toBe('fix') // "resolve" wins over "verify"
    expect(classifySubagent('Verify 4 stabilization fixes')).toBe('check')
  })

  it('classifies create/build descriptions', () => {
    expect(classifySubagent('Create Notion DB batch 1')).toBe('create')
    expect(classifySubagent('Draft issue response')).toBe('create')
    expect(classifySubagent('Generate test steps')).toBe('create')
  })

  it('returns other for unclassifiable descriptions', () => {
    expect(classifySubagent('Backfill email on 100 Notion pages')).toBe('other')
    expect(classifySubagent('Download screenshots from blob storage')).toBe('other')
  })
})

// ─── detectPatterns ────────────────────────────────────────

describe('detectPatterns', () => {
  it('groups similar descriptions', () => {
    const signals: SubagentSignal[] = [
      makeSignal('Create Notion DB batch 1'),
      makeSignal('Create Notion DB batch 2'),
      makeSignal('Create Notion DB batch 3'),
      makeSignal('Fix build errors'),
      makeSignal('Something unique'),
    ]

    const patterns = detectPatterns(signals)
    expect(patterns.length).toBe(1)
    expect(patterns[0].pattern).toContain('create notion db batch')
    expect(patterns[0].count).toBe(3)
    expect(patterns[0].category).toBe('create')
  })

  it('returns empty for all unique descriptions', () => {
    const signals: SubagentSignal[] = [
      makeSignal('Fix build errors'),
      makeSignal('Query App Insights'),
      makeSignal('Research benchmarks'),
    ]

    const patterns = detectPatterns(signals)
    expect(patterns.length).toBe(0)
  })

  it('normalizes ticket numbers and hashes', () => {
    const signals: SubagentSignal[] = [
      makeSignal('Fix PR #123 comments'),
      makeSignal('Fix PR #456 comments'),
    ]

    const patterns = detectPatterns(signals)
    expect(patterns.length).toBe(1)
    expect(patterns[0].count).toBe(2)
  })
})

// ─── scanSubagents (with mock filesystem) ──────────────────

const TEST_CWD = '/tmp/test-subagent-intel-project'
const ENCODED = TEST_CWD.replace(/[^a-zA-Z0-9]/g, '-')
const PROJECT_DIR = resolve(homedir(), '.claude', 'projects', ENCODED)

describe('scanSubagents', () => {
  beforeEach(() => {
    const sessionDir = resolve(PROJECT_DIR, '00000000-0000-0000-0000-000000000001', 'subagents')
    mkdirSync(sessionDir, { recursive: true })

    writeFileSync(
      resolve(sessionDir, 'agent-a1.meta.json'),
      JSON.stringify({ agentType: 'general-purpose', description: 'Fix build errors' })
    )
    writeFileSync(
      resolve(sessionDir, 'agent-a2.meta.json'),
      JSON.stringify({ agentType: 'Explore', description: 'Find retry logic' })
    )

    // Add a second session
    const sessionDir2 = resolve(PROJECT_DIR, '00000000-0000-0000-0000-000000000002', 'subagents')
    mkdirSync(sessionDir2, { recursive: true })

    writeFileSync(
      resolve(sessionDir2, 'agent-a3.meta.json'),
      JSON.stringify({ agentType: 'general-purpose', description: 'Fix test failures' })
    )
  })

  afterEach(() => {
    try { rmSync(PROJECT_DIR, { recursive: true }) } catch {}
  })

  it('scans all sessions and returns signals', () => {
    const summary = scanSubagents(TEST_CWD)
    expect(summary.total).toBe(3)
    expect(summary.byCategory.fix).toBe(2)
    expect(summary.byCategory.find).toBe(1)
    expect(summary.byAgentType['general-purpose']).toBe(2)
    expect(summary.byAgentType['Explore']).toBe(1)
  })

  it('returns empty for non-existent project', () => {
    const summary = scanSubagents('/tmp/no-such-project-ever-xyz')
    expect(summary.total).toBe(0)
  })
})

describe('scanSessionSubagents', () => {
  beforeEach(() => {
    const sessionDir = resolve(PROJECT_DIR, '00000000-0000-0000-0000-000000000001', 'subagents')
    mkdirSync(sessionDir, { recursive: true })

    writeFileSync(
      resolve(sessionDir, 'agent-a1.meta.json'),
      JSON.stringify({ agentType: 'general-purpose', description: 'Fix build errors' })
    )
  })

  afterEach(() => {
    try { rmSync(PROJECT_DIR, { recursive: true }) } catch {}
  })

  it('scans only the specified session', () => {
    const signals = scanSessionSubagents(TEST_CWD, '00000000-0000-0000-0000-000000000001')
    expect(signals.length).toBe(1)
    expect(signals[0].description).toBe('Fix build errors')
  })

  it('returns empty for non-existent session', () => {
    const signals = scanSessionSubagents(TEST_CWD, '99999999-9999-9999-9999-999999999999')
    expect(signals.length).toBe(0)
  })
})

// ─── Helpers ──────────────────────────────────────────────

function makeSignal(description: string): SubagentSignal {
  return {
    sessionId: 'test-session',
    agentId: 'agent-test',
    agentType: 'general-purpose',
    description,
    category: classifySubagent(description),
    filesTouched: [],
    turnCount: 5,
    timestamp: Date.now(),
  }
}
