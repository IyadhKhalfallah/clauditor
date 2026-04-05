import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Fresh module import with mocked homedir
async function importFresh(tempDir: string) {
  vi.resetModules()
  vi.doMock('node:os', () => ({ homedir: () => tempDir }))
  return await import('./session-state.js')
}

// Helper to build a JSONL transcript from an array of record objects
function buildTranscript(records: Record<string, unknown>[]): string {
  return records.map(r => JSON.stringify(r)).join('\n')
}

// Helper to create a user record
function userRecord(
  msg: string,
  opts: { cwd?: string; branch?: string; isMeta?: boolean; sessionId?: string } = {}
) {
  return {
    type: 'user',
    uuid: `u-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: opts.sessionId || 's1',
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: msg },
    cwd: opts.cwd || '/home/user/project',
    gitBranch: opts.branch || 'main',
    ...(opts.isMeta ? { isMeta: true } : {}),
  }
}

// Helper to create an assistant record with usage (counts as a turn)
function assistantRecord(
  text: string,
  toolUses: Array<{ name: string; input: Record<string, unknown> }> = [],
  usage = { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 100, cache_read_input_tokens: 800 }
) {
  const content: Array<Record<string, unknown>> = []
  if (text) {
    content.push({ type: 'text', text })
  }
  for (const tool of toolUses) {
    content.push({ type: 'tool_use', id: `tu_${Math.random().toString(36).slice(2, 8)}`, name: tool.name, input: tool.input })
  }
  return {
    type: 'assistant',
    uuid: `a-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: 's1',
    timestamp: new Date().toISOString(),
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content,
      usage,
    },
  }
}

// Helper to create an assistant record WITHOUT usage (does not count as a turn)
function assistantRecordNoUsage(text: string) {
  return {
    type: 'assistant',
    uuid: `a-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: 's1',
    timestamp: new Date().toISOString(),
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text }],
    },
  }
}

// Build a minimal transcript with N turns (assistant records with usage)
function buildMinimalTranscript(turnCount: number, opts: { cwd?: string; branch?: string } = {}) {
  const records: Record<string, unknown>[] = []
  records.push(userRecord('initial task', { cwd: opts.cwd, branch: opts.branch }))
  for (let i = 0; i < turnCount; i++) {
    records.push(assistantRecord(`response ${i}`))
    if (i < turnCount - 1) {
      records.push(userRecord(`follow-up ${i}`))
    }
  }
  return buildTranscript(records)
}

describe('extractSessionStateFromTranscript', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clauditor-extract-'))
  })

  afterEach(() => {
    vi.doUnmock('node:os')
    vi.resetModules()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('extracts cwd and branch from last user record', async () => {
    const mod = await importFresh(tempDir)
    const transcript = buildTranscript([
      userRecord('first message', { cwd: '/old/path', branch: 'old-branch' }),
      assistantRecord('response 1'),
      userRecord('second message', { cwd: '/old/path', branch: 'old-branch' }),
      assistantRecord('response 2'),
      userRecord('third message', { cwd: '/new/path', branch: 'feat/new' }),
      assistantRecord('response 3'),
      userRecord('fourth', { cwd: '/new/path', branch: 'feat/new' }),
      assistantRecord('response 4'),
      userRecord('fifth', { cwd: '/new/path', branch: 'feat/new' }),
      assistantRecord('response 5'),
    ])
    const filePath = join(tempDir, 'transcript.jsonl')
    writeFileSync(filePath, transcript)

    const result = mod.extractSessionStateFromTranscript('s1', filePath)
    expect(result).not.toBeNull()
    expect(result!.cwd).toBe('/new/path')
    expect(result!.branch).toBe('feat/new')
  })

  it('counts only assistant records with usage as turns', async () => {
    const mod = await importFresh(tempDir)
    const records = [
      userRecord('task'),
      assistantRecord('turn 1'),
      userRecord('msg 2'),
      assistantRecord('turn 2'),
      userRecord('msg 3'),
      assistantRecord('turn 3'),
      userRecord('msg 4'),
      assistantRecordNoUsage('no usage - not a turn'),
      userRecord('msg 5'),
      assistantRecord('turn 4'),
      userRecord('msg 6'),
      assistantRecord('turn 5'),
    ]
    const filePath = join(tempDir, 'transcript.jsonl')
    writeFileSync(filePath, buildTranscript(records))

    const result = mod.extractSessionStateFromTranscript('s1', filePath)
    expect(result).not.toBeNull()
    expect(result!.turns).toBe(5)
  })

  it('returns null with fewer than 5 turns', async () => {
    const mod = await importFresh(tempDir)
    const filePath = join(tempDir, 'transcript.jsonl')
    writeFileSync(filePath, buildMinimalTranscript(4))

    const result = mod.extractSessionStateFromTranscript('s1', filePath)
    expect(result).toBeNull()
  })

  it('extracts files modified from Edit/Write tool_use blocks', async () => {
    const mod = await importFresh(tempDir)
    const records = [
      userRecord('implement feature'),
      assistantRecord('editing files', [
        { name: 'Edit', input: { file_path: '/home/user/project/src/login.tsx' } },
        { name: 'Write', input: { file_path: '/home/user/project/src/auth.ts' } },
      ]),
      userRecord('next'),
      assistantRecord('more edits', [
        { name: 'Edit', input: { file_path: '/home/user/project/src/utils.ts' } },
      ]),
      userRecord('continue'),
      assistantRecord('turn 3'),
      userRecord('go on'),
      assistantRecord('turn 4'),
      userRecord('wrap up'),
      assistantRecord('turn 5'),
    ]
    const filePath = join(tempDir, 'transcript.jsonl')
    writeFileSync(filePath, buildTranscript(records))

    const result = mod.extractSessionStateFromTranscript('s1', filePath)
    expect(result).not.toBeNull()
    expect(result!.filesModified).toContain('login.tsx')
    expect(result!.filesModified).toContain('auth.ts')
    expect(result!.filesModified).toContain('utils.ts')
    expect(result!.filesModified).toHaveLength(3)
  })

  it('extracts files read from Read tool_use blocks', async () => {
    const mod = await importFresh(tempDir)
    const records = [
      userRecord('review code'),
      assistantRecord('reading files', [
        { name: 'Read', input: { file_path: '/home/user/project/package.json' } },
        { name: 'Read', input: { file_path: '/home/user/project/src/index.ts' } },
      ]),
      userRecord('next'),
      assistantRecord('turn 2'),
      userRecord('go on'),
      assistantRecord('turn 3'),
      userRecord('continue'),
      assistantRecord('turn 4'),
      userRecord('wrap up'),
      assistantRecord('turn 5'),
    ]
    const filePath = join(tempDir, 'transcript.jsonl')
    writeFileSync(filePath, buildTranscript(records))

    const result = mod.extractSessionStateFromTranscript('s1', filePath)
    expect(result).not.toBeNull()
    expect(result!.filesRead).toContain('package.json')
    expect(result!.filesRead).toContain('index.ts')
    expect(result!.filesRead).toHaveLength(2)
  })

  it('extracts git commit messages in HEREDOC format', async () => {
    const mod = await importFresh(tempDir)
    const heredocCmd = `git commit -m "$(cat <<'EOF'\nfeat: add login page\nEOF\n)"`
    const records = [
      userRecord('commit changes'),
      assistantRecord('committing', [
        { name: 'Bash', input: { command: heredocCmd } },
      ]),
      userRecord('next'),
      assistantRecord('turn 2'),
      userRecord('go on'),
      assistantRecord('turn 3'),
      userRecord('continue'),
      assistantRecord('turn 4'),
      userRecord('wrap up'),
      assistantRecord('turn 5'),
    ]
    const filePath = join(tempDir, 'transcript.jsonl')
    writeFileSync(filePath, buildTranscript(records))

    const result = mod.extractSessionStateFromTranscript('s1', filePath)
    expect(result).not.toBeNull()
    expect(result!.gitCommits).toContain('feat: add login page')
  })

  it('extracts git commit messages in standard -m format', async () => {
    const mod = await importFresh(tempDir)
    const records = [
      userRecord('commit'),
      assistantRecord('committing', [
        { name: 'Bash', input: { command: 'git commit -m "fix: resolve auth bug"' } },
      ]),
      userRecord('next'),
      assistantRecord('done', [
        { name: 'Bash', input: { command: "git commit -m 'chore: update deps'" } },
      ]),
      userRecord('go on'),
      assistantRecord('turn 3'),
      userRecord('continue'),
      assistantRecord('turn 4'),
      userRecord('wrap up'),
      assistantRecord('turn 5'),
    ]
    const filePath = join(tempDir, 'transcript.jsonl')
    writeFileSync(filePath, buildTranscript(records))

    const result = mod.extractSessionStateFromTranscript('s1', filePath)
    expect(result).not.toBeNull()
    expect(result!.gitCommits).toContain('fix: resolve auth bug')
    expect(result!.gitCommits).toContain('chore: update deps')
  })

  it('extracts key commands matching test/build/deploy/lint/install/migrate/seed', async () => {
    const mod = await importFresh(tempDir)
    const records = [
      userRecord('run tests'),
      assistantRecord('running', [
        { name: 'Bash', input: { command: 'npm test' } },
        { name: 'Bash', input: { command: 'npm run build' } },
        { name: 'Bash', input: { command: 'npx prisma migrate dev' } },
      ]),
      userRecord('next'),
      assistantRecord('more', [
        { name: 'Bash', input: { command: 'npm install express' } },
        { name: 'Bash', input: { command: 'npm run lint' } },
      ]),
      userRecord('go on'),
      assistantRecord('turn 3'),
      userRecord('continue'),
      assistantRecord('turn 4'),
      userRecord('wrap up'),
      assistantRecord('turn 5'),
    ]
    const filePath = join(tempDir, 'transcript.jsonl')
    writeFileSync(filePath, buildTranscript(records))

    const result = mod.extractSessionStateFromTranscript('s1', filePath)
    expect(result).not.toBeNull()
    expect(result!.keyCommands).toContain('npm test')
    expect(result!.keyCommands).toContain('npm run build')
    expect(result!.keyCommands).toContain('npx prisma migrate dev')
    expect(result!.keyCommands).toContain('npm install express')
    expect(result!.keyCommands).toContain('npm run lint')
  })

  it('extracts user messages and skips meta/system messages', async () => {
    const mod = await importFresh(tempDir)
    const records = [
      userRecord('implement the login page'),
      assistantRecord('turn 1'),
      userRecord('', { isMeta: true }), // meta message skipped
      assistantRecord('turn 2'),
      userRecord('add validation'),
      assistantRecord('turn 3'),
      userRecord('deploy it'),
      assistantRecord('turn 4'),
      userRecord('looks good'),
      assistantRecord('turn 5'),
    ]
    const filePath = join(tempDir, 'transcript.jsonl')
    writeFileSync(filePath, buildTranscript(records))

    const result = mod.extractSessionStateFromTranscript('s1', filePath)
    expect(result).not.toBeNull()
    expect(result!.originalTask).toBe('implement the login page')
    expect(result!.recentUserMessages).toHaveLength(3)
    expect(result!.recentUserMessages).toContain('deploy it')
    expect(result!.recentUserMessages).toContain('looks good')
  })

  it('skips user messages starting with < (system/XML tags)', async () => {
    const mod = await importFresh(tempDir)
    const records = [
      userRecord('<system-reminder>some system content</system-reminder>'),
      assistantRecord('turn 1'),
      userRecord('real first task'),
      assistantRecord('turn 2'),
      userRecord('follow-up'),
      assistantRecord('turn 3'),
      userRecord('more work'),
      assistantRecord('turn 4'),
      userRecord('final'),
      assistantRecord('turn 5'),
    ]
    const filePath = join(tempDir, 'transcript.jsonl')
    writeFileSync(filePath, buildTranscript(records))

    const result = mod.extractSessionStateFromTranscript('s1', filePath)
    expect(result).not.toBeNull()
    expect(result!.originalTask).toBe('real first task')
  })

  it('captures last assistant text message', async () => {
    const mod = await importFresh(tempDir)
    const records = [
      userRecord('start'),
      assistantRecord('first response'),
      userRecord('next'),
      assistantRecord('second response'),
      userRecord('go on'),
      assistantRecord('third response'),
      userRecord('continue'),
      assistantRecord('fourth response'),
      userRecord('wrap up'),
      assistantRecord('Here are the next steps: deploy to staging and run e2e tests.'),
    ]
    const filePath = join(tempDir, 'transcript.jsonl')
    writeFileSync(filePath, buildTranscript(records))

    const result = mod.extractSessionStateFromTranscript('s1', filePath)
    expect(result).not.toBeNull()
    expect(result!.lastAssistantMessage).toBe('Here are the next steps: deploy to staging and run e2e tests.')
  })

  it('calculates waste factor from first 5 vs last 5 turns', async () => {
    const mod = await importFresh(tempDir)
    // First 5 turns: 1000 tokens each, last 5 turns: 3000 tokens each
    const smallUsage = { input_tokens: 500, output_tokens: 300, cache_creation_input_tokens: 100, cache_read_input_tokens: 100 }
    const largeUsage = { input_tokens: 1500, output_tokens: 900, cache_creation_input_tokens: 300, cache_read_input_tokens: 300 }
    const records: Record<string, unknown>[] = [userRecord('start')]
    // 5 small turns
    for (let i = 0; i < 5; i++) {
      records.push(assistantRecord(`small ${i}`, [], smallUsage))
      records.push(userRecord(`msg ${i}`))
    }
    // 5 large turns (3x tokens)
    for (let i = 0; i < 5; i++) {
      records.push(assistantRecord(`large ${i}`, [], largeUsage))
      if (i < 4) records.push(userRecord(`msg large ${i}`))
    }
    const filePath = join(tempDir, 'transcript.jsonl')
    writeFileSync(filePath, buildTranscript(records))

    const result = mod.extractSessionStateFromTranscript('s1', filePath)
    expect(result).not.toBeNull()
    // baseline = 1000, current = 3000, wasteFactor = 3
    expect(result!.wasteFactor).toBe(3)
    expect(result!.turns).toBe(10)
  })

  it('deduplicates key commands', async () => {
    const mod = await importFresh(tempDir)
    const records = [
      userRecord('run tests'),
      assistantRecord('running', [
        { name: 'Bash', input: { command: 'npm test' } },
      ]),
      userRecord('again'),
      assistantRecord('running again', [
        { name: 'Bash', input: { command: 'npm test' } },
        { name: 'Bash', input: { command: 'npm test' } },
      ]),
      userRecord('go on'),
      assistantRecord('turn 3', [
        { name: 'Bash', input: { command: 'npm run build' } },
      ]),
      userRecord('continue'),
      assistantRecord('turn 4'),
      userRecord('wrap up'),
      assistantRecord('turn 5'),
    ]
    const filePath = join(tempDir, 'transcript.jsonl')
    writeFileSync(filePath, buildTranscript(records))

    const result = mod.extractSessionStateFromTranscript('s1', filePath)
    expect(result).not.toBeNull()
    // 'npm test' should appear only once despite 3 occurrences
    const testCmdCount = result!.keyCommands.filter(c => c === 'npm test').length
    expect(testCmdCount).toBe(1)
    expect(result!.keyCommands).toContain('npm run build')
  })
})

describe('extractHandoffDescription', () => {
  it('PostCompact: extracts first meaningful line, skipping headers/blockquotes/tags', async () => {
    const mod = await importFresh(mkdtempSync(join(tmpdir(), 'clauditor-hd-')))
    const handoff = {
      path: '/tmp/test.md',
      timestamp: Date.now(),
      isPostCompact: true,
      content: [
        '# Last Session (saved by clauditor via PostCompact)',
        '',
        '> This summary was generated by Claude while it still had full context.',
        '',
        '<analysis>',
        'User is implementing a REST API with authentication and pagination support.',
        '</analysis>',
      ].join('\n'),
    }
    const desc = mod.extractHandoffDescription(handoff)
    expect(desc).toBe('User is implementing a REST API with authentication and pagination support.')
  })

  it('PostCompact: cleans bold/numbered prefixes from meaningful lines', async () => {
    const mod = await importFresh(mkdtempSync(join(tmpdir(), 'clauditor-hd-')))
    const handoff = {
      path: '/tmp/test.md',
      timestamp: Date.now(),
      isPostCompact: true,
      content: [
        '# Last Session',
        '',
        '> Summary by Claude.',
        '',
        '1. **Current State:** Building the login flow with JWT tokens',
      ].join('\n'),
    }
    const desc = mod.extractHandoffDescription(handoff)
    expect(desc).toBe('Building the login flow with JWT tokens')
  })

  it('Mechanical: extracts branch + where we left off', async () => {
    const mod = await importFresh(mkdtempSync(join(tmpdir(), 'clauditor-hd-')))
    const handoff = {
      path: '/tmp/test.md',
      timestamp: Date.now(),
      isPostCompact: false,
      content: [
        '# Last Session (saved by clauditor)',
        '',
        '- **Branch:** feat/auth',
        '- **Session size:** 25 turns, 40k tokens/turn',
        '',
        '## Where We Left Off',
        'Implementing JWT refresh token rotation with Redis cache.',
      ].join('\n'),
    }
    const desc = mod.extractHandoffDescription(handoff)
    expect(desc).toBe('feat/auth — Implementing JWT refresh token rotation with Redis cache.')
  })

  it('Mechanical: falls back to branch + original task', async () => {
    const mod = await importFresh(mkdtempSync(join(tmpdir(), 'clauditor-hd-')))
    const handoff = {
      path: '/tmp/test.md',
      timestamp: Date.now(),
      isPostCompact: false,
      content: [
        '# Last Session (saved by clauditor)',
        '',
        '- **Branch:** feat/payments',
        '',
        '## Original Task',
        'Add Stripe payment integration with webhook handling',
      ].join('\n'),
    }
    const desc = mod.extractHandoffDescription(handoff)
    expect(desc).toBe('feat/payments — Add Stripe payment integration with webhook handling')
  })

  it('Mechanical: falls back to recent user messages', async () => {
    const mod = await importFresh(mkdtempSync(join(tmpdir(), 'clauditor-hd-')))
    const handoff = {
      path: '/tmp/test.md',
      timestamp: Date.now(),
      isPostCompact: false,
      content: [
        '# Last Session (saved by clauditor)',
        '',
        '- **Branch:** fix/perf',
        '',
        '## Recent User Messages',
        '> Optimize the database queries for the dashboard endpoint',
      ].join('\n'),
    }
    const desc = mod.extractHandoffDescription(handoff)
    expect(desc).toBe('fix/perf — Optimize the database queries for the dashboard endpoint')
  })

  it('Mechanical: branch + session size as last resort', async () => {
    const mod = await importFresh(mkdtempSync(join(tmpdir(), 'clauditor-hd-')))
    const handoff = {
      path: '/tmp/test.md',
      timestamp: Date.now(),
      isPostCompact: false,
      content: [
        '# Last Session (saved by clauditor)',
        '',
        '- **Branch:** main',
        '- **Session size:** 10 turns, 20k tokens/turn',
      ].join('\n'),
    }
    const desc = mod.extractHandoffDescription(handoff)
    expect(desc).toBe('main (10 turns, 20k tokens/turn)')
  })

  it('returns generic fallback when nothing found', async () => {
    const mod = await importFresh(mkdtempSync(join(tmpdir(), 'clauditor-hd-')))
    const mechanicalHandoff = {
      path: '/tmp/test.md',
      timestamp: Date.now(),
      isPostCompact: false,
      content: '# Minimal\n',
    }
    expect(mod.extractHandoffDescription(mechanicalHandoff)).toBe('Session snapshot')

    const postCompactHandoff = {
      path: '/tmp/test.md',
      timestamp: Date.now(),
      isPostCompact: true,
      content: '# Header\n> Quote\n<tag>\n',
    }
    expect(mod.extractHandoffDescription(postCompactHandoff)).toBe('Claude-generated summary')
  })
})
