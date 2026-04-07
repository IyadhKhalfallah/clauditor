import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  extractFacts, scoreHandoff, detectInformationLoss, generateReport,
  type TranscriptFact, type FactCategory,
} from './handoff-quality.js'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clauditor-hq-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function writeTranscript(filename: string, records: object[]): string {
  const path = resolve(tempDir, filename)
  writeFileSync(path, records.map(r => JSON.stringify(r)).join('\n'))
  return path
}

// ─── extractFacts ───────────────────────────────────────────

describe('extractFacts', () => {
  it('extracts file modifications with high weight', () => {
    const path = writeTranscript('edit.jsonl', [
      { type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Edit', input: { file_path: '/Users/dev/project/src/app/layout.tsx' } },
        { type: 'tool_use', name: 'Write', input: { file_path: '/Users/dev/project/src/lib/utils.ts' } },
      ] } },
    ])
    const facts = extractFacts(path)
    const modified = facts.filter(f => f.category === 'file_modified')
    expect(modified.length).toBe(2)
    expect(modified[0].weight).toBe(0.9)
  })

  it('extracts file reads with low weight, excludes modified files', () => {
    const path = writeTranscript('read.jsonl', [
      { type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Read', input: { file_path: '/Users/dev/project/src/config.ts' } },
        { type: 'tool_use', name: 'Read', input: { file_path: '/Users/dev/project/src/app.tsx' } },
        { type: 'tool_use', name: 'Edit', input: { file_path: '/Users/dev/project/src/app.tsx' } },
      ] } },
    ])
    const facts = extractFacts(path)
    expect(facts.filter(f => f.category === 'file_read').length).toBe(1)
    expect(facts.filter(f => f.category === 'file_modified').length).toBe(1)
  })

  it('extracts git commits', () => {
    const path = writeTranscript('commit.jsonl', [
      { type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Bash', input: { command: 'git commit -m "fix: improve Clerk contrast"' } },
      ] } },
    ])
    const commits = extractFacts(path).filter(f => f.category === 'commit')
    expect(commits.length).toBe(1)
    expect(commits[0].value).toContain('improve Clerk contrast')
    expect(commits[0].weight).toBe(0.8)
  })

  it('extracts errors from tool results', () => {
    const path = writeTranscript('error.jsonl', [
      { type: 'user', message: { content: [
        { type: 'tool_result', content: 'Error: Exit code 1\nModule not found: Cannot resolve @/lib/db' },
      ] } },
    ])
    const errors = extractFacts(path).filter(f => f.category === 'error_hit')
    expect(errors.length).toBe(1)
    expect(errors[0].weight).toBe(0.7)
  })

  it('extracts key commands (build, test, deploy)', () => {
    const path = writeTranscript('cmds.jsonl', [
      { type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Bash', input: { command: 'npm run build' } },
        { type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } },
        { type: 'tool_use', name: 'Bash', input: { command: 'npm test -- --watch' } },
      ] } },
    ])
    const cmds = extractFacts(path).filter(f => f.category === 'command_run')
    expect(cmds.length).toBe(2)
  })

  it('extracts user preferences with highest weight', () => {
    const path = writeTranscript('prefs.jsonl', [
      { type: 'user', message: { content: [
        { type: 'text', text: "don't add co-author lines to commits" },
      ] } },
    ])
    const prefs = extractFacts(path).filter(f => f.category === 'user_preference')
    expect(prefs.length).toBe(1)
    expect(prefs[0].weight).toBe(1.0)
  })

  it('extracts rejected approaches with highest weight (Tang et al.)', () => {
    const path = writeTranscript('rejected.jsonl', [
      { type: 'assistant', message: { content: [
        { type: 'text', text: 'I tried using inline styles but that didn\'t work because Clerk overrides them.' },
      ] } },
    ])
    const rejected = extractFacts(path).filter(f => f.category === 'approach_rejected')
    expect(rejected.length).toBeGreaterThanOrEqual(1)
    expect(rejected[0].weight).toBe(1.0)
    expect(rejected.some(r => r.value.includes('inline styles'))).toBe(true)
  })

  it('extracts conditional relationships (Tang et al.)', () => {
    const path = writeTranscript('cond.jsonl', [
      { type: 'assistant', message: { content: [
        { type: 'text', text: 'You need to run the database migrations before building the application successfully.' },
      ] } },
    ])
    const conds = extractFacts(path).filter(f => f.category === 'conditional')
    expect(conds.length).toBe(1)
    expect(conds[0].weight).toBe(0.9)
  })

  it('extracts temporal sequences from key commands', () => {
    const path = writeTranscript('temporal.jsonl', [
      { type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Bash', input: { command: 'npx drizzle-kit push' } },
      ] } },
      { type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Bash', input: { command: 'npm run build' } },
      ] } },
      { type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Bash', input: { command: 'railway up --deploy' } },
      ] } },
    ])
    const seqs = extractFacts(path).filter(f => f.category === 'temporal_sequence')
    expect(seqs.length).toBe(1)
    expect(seqs[0].value).toContain('→')
  })

  it('returns empty for missing file', () => {
    expect(extractFacts('/nonexistent.jsonl')).toEqual([])
  })
})

// ─── scoreHandoff ───────────────────────────────────────────

describe('scoreHandoff', () => {
  it('scores 100% when all facts are preserved', () => {
    const facts: TranscriptFact[] = [
      { category: 'file_modified', value: 'layout.tsx', weight: 0.9 },
      { category: 'commit', value: 'fix: improve contrast', weight: 0.8 },
    ]
    const summary = 'Modified layout.tsx to fix: improve contrast on dark background'
    const score = scoreHandoff(facts, summary)
    expect(score.score).toBe(1)
    expect(score.lostFacts.length).toBe(0)
  })

  it('scores 0% when nothing is preserved', () => {
    const facts: TranscriptFact[] = [
      { category: 'file_modified', value: 'layout.tsx', weight: 0.9 },
      { category: 'error_hit', value: 'Module not found: @/lib/db', weight: 0.7 },
    ]
    const summary = 'Worked on the project today.'
    const score = scoreHandoff(facts, summary)
    expect(score.score).toBe(0)
    expect(score.lostFacts.length).toBe(2)
  })

  it('weights high-importance facts more heavily', () => {
    const facts: TranscriptFact[] = [
      { category: 'user_preference', value: "don't add co-author lines to commits please", weight: 1.0 },
      { category: 'file_read', value: 'readme.md', weight: 0.3 },
    ]
    const summary = 'Read readme.md for project setup'
    const score = scoreHandoff(facts, summary)
    expect(score.score).toBeLessThan(0.5)
    expect(score.lostFacts[0].category).toBe('user_preference')
  })

  it('provides per-category breakdown', () => {
    const facts: TranscriptFact[] = [
      { category: 'file_modified', value: 'layout.tsx', weight: 0.9 },
      { category: 'file_modified', value: 'globals.css', weight: 0.9 },
      { category: 'commit', value: 'fix: theme contrast', weight: 0.8 },
    ]
    const summary = 'Modified layout.tsx. Committed theme contrast fix.'
    const score = scoreHandoff(facts, summary)
    expect(score.categories['file_modified'].total).toBe(2)
    expect(score.categories['file_modified'].preserved).toBe(1)
    expect(score.categories['commit'].preserved).toBe(1)
  })

  it('detects preserved approach rejections', () => {
    const facts: TranscriptFact[] = [
      { category: 'approach_rejected', value: 'tried inline styles but Clerk overrides them', weight: 1.0 },
    ]
    const summary = 'Attempted inline styles approach but Clerk overrides prevented it from working'
    const score = scoreHandoff(facts, summary)
    expect(score.score).toBe(1)
  })

  it('detects temporal sequence preservation (correct order)', () => {
    const facts: TranscriptFact[] = [
      { category: 'temporal_sequence', value: 'npx drizzle-kit push → npm run build → railway up', weight: 0.7 },
    ]
    const correctOrder = 'First ran npx drizzle-kit push, then npm run build, finally railway up'
    expect(scoreHandoff(facts, correctOrder).score).toBe(1)
  })

  it('detects temporal sequence loss (wrong order)', () => {
    const facts: TranscriptFact[] = [
      { category: 'temporal_sequence', value: 'npx drizzle-kit push → npm run build → railway up', weight: 0.7 },
    ]
    const wrongOrder = 'Ran railway up, then npm run build, then npx drizzle-kit push'
    expect(scoreHandoff(facts, wrongOrder).score).toBe(0)
  })

  it('scores empty facts as 100%', () => {
    expect(scoreHandoff([], 'some summary').score).toBe(1)
  })
})

// ─── Semantic Drift Detection ───────────────────────────────

describe('semantic drift detection', () => {
  it('detects reordered temporal sequences', () => {
    const facts: TranscriptFact[] = [
      { category: 'temporal_sequence', value: 'npm run build → npm test → railway up', weight: 0.7 },
    ]
    const summary = 'deployed with railway up, ran npm test to verify, and npm run build for the release'
    const score = scoreHandoff(facts, summary)
    expect(score.driftDetections.length).toBe(1)
    expect(score.driftDetections[0].description).toContain('order changed')
  })

  it('does not flag correctly ordered sequences', () => {
    const facts: TranscriptFact[] = [
      { category: 'temporal_sequence', value: 'npm run build → npm test', weight: 0.7 },
    ]
    const summary = 'ran npm run build successfully, then npm test passed'
    const score = scoreHandoff(facts, summary)
    expect(score.driftDetections.length).toBe(0)
  })
})

// ─── detectInformationLoss ──────────────────────────────────

describe('detectInformationLoss', () => {
  it('detects redundant file reads', () => {
    const oldFacts: TranscriptFact[] = [
      { category: 'file_read', value: 'layout.tsx', weight: 0.3 },
      { category: 'file_modified', value: 'decay.ts', weight: 0.9 },
    ]
    const newPath = writeTranscript('new.jsonl', [
      { type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Read', input: { file_path: '/Users/dev/project/src/app/layout.tsx' } },
        { type: 'tool_use', name: 'Read', input: { file_path: '/Users/dev/project/src/lib/newfile.ts' } },
      ] } },
    ])
    const signals = detectInformationLoss(oldFacts, newPath)
    expect(signals.redundantReads.length).toBe(1)
  })

  it('counts re-discovery turns before first edit', () => {
    const newPath = writeTranscript('rediscovery.jsonl', [
      { type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Read', input: { file_path: 'src/a.ts' } },
      ] } },
      { type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Bash', input: { command: 'git status' } },
      ] } },
      { type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Edit', input: { file_path: 'src/a.ts' } },
      ] } },
    ])
    const signals = detectInformationLoss([], newPath)
    expect(signals.rediscoveryTurns).toBe(2)
  })

  it('detects user corrections indicating lost context', () => {
    const newPath = writeTranscript('corrections.jsonl', [
      { type: 'user', message: { content: [
        { type: 'text', text: 'I already told you, we use drizzle not prisma' },
      ] } },
      { type: 'user', message: { content: [
        { type: 'text', text: 'we already tried that approach and it failed' },
      ] } },
      { type: 'user', message: { content: [
        { type: 'text', text: 'Can you help me with the layout?' },
      ] } },
    ])
    const signals = detectInformationLoss([], newPath)
    expect(signals.userCorrections.length).toBe(2)
  })

  it('zero re-discovery when first action is an edit', () => {
    const newPath = writeTranscript('immediate.jsonl', [
      { type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Edit', input: { file_path: 'src/a.ts' } },
      ] } },
    ])
    const signals = detectInformationLoss([], newPath)
    expect(signals.rediscoveryTurns).toBe(0)
  })
})

// ─── generateReport ─────────────────────────────────────────

describe('generateReport', () => {
  it('generates report with score and categories', () => {
    const score = scoreHandoff(
      [
        { category: 'file_modified', value: 'layout.tsx', weight: 0.9 },
        { category: 'user_preference', value: "don't add co-author lines", weight: 1.0 },
        { category: 'approach_rejected', value: 'tried inline styles', weight: 1.0 },
      ],
      'Modified layout.tsx file'
    )
    const report = generateReport(score, {
      redundantReads: ['config.ts'],
      rediscoveryTurns: 3,
      repeatedErrors: [],
      userCorrections: ['I already told you about the co-author rule'],
    })
    expect(report).toContain('Handoff Quality')
    expect(report).toContain('Score')
    expect(report).toContain('Files modified')
    expect(report).toContain('Redundant reads')
    expect(report).toContain('Corrections')
  })

  it('includes overwrite and drift warnings when detected', () => {
    const score = {
      totalFacts: 2,
      preservedFacts: 1,
      score: 0.5,
      categories: {},
      lostFacts: [],
      overwriteDetections: [{
        originalFact: 'postgres.railway.internal refused',
        summaryVersion: 'database connection issue',
        category: 'error_hit' as FactCategory,
      }],
      driftDetections: [{
        description: 'Command execution order changed',
        originalOrder: ['build', 'test'],
        summaryOrder: ['test', 'build'],
      }],
    }
    const report = generateReport(score)
    expect(report).toContain('overwriting')
    expect(report).toContain('drift')
  })
})
