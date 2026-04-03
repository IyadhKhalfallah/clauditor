import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { extractSessionStateFromTranscript, saveSessionState, readLastSessionState } from './session-state.js'

function makeUserRecord(id: string, content: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: 'user',
    uuid: `u-${id}`,
    parentUuid: null,
    sessionId: 's1',
    timestamp: '2026-04-03T12:00:00Z',
    message: { role: 'user', content },
    cwd: '/home/user/project',
    gitBranch: 'feat/test',
    version: '2.1.91',
    ...extra,
  })
}

function makeAssistantRecord(id: string, opts: {
  text?: string;
  toolCalls?: Array<{ name: string; input: Record<string, unknown> }>;
  tokens?: { input: number; output: number; cacheRead: number; cacheCreate: number };
}) {
  const content: unknown[] = []
  if (opts.text) {
    content.push({ type: 'text', text: opts.text })
  }
  if (opts.toolCalls) {
    for (const tc of opts.toolCalls) {
      content.push({ type: 'tool_use', id: `tool-${id}`, name: tc.name, input: tc.input })
    }
  }
  const tokens = opts.tokens || { input: 1000, output: 500, cacheRead: 8000, cacheCreate: 200 }
  return JSON.stringify({
    type: 'assistant',
    uuid: `a-${id}`,
    parentUuid: `u-${id}`,
    sessionId: 's1',
    timestamp: '2026-04-03T12:00:00Z',
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      id: `msg_${id}`,
      content,
      usage: {
        input_tokens: tokens.input,
        output_tokens: tokens.output,
        cache_creation_input_tokens: tokens.cacheCreate,
        cache_read_input_tokens: tokens.cacheRead,
      },
    },
  })
}

describe('extractSessionStateFromTranscript', () => {
  let tempDir: string

  function writeSession(lines: string[]): string {
    const filePath = join(tempDir, 'session.jsonl')
    writeFileSync(filePath, lines.join('\n'))
    return filePath
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clauditor-session-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('extracts original task from first user message', () => {
    const lines = [
      makeUserRecord('1', 'Build a REST API for user management'),
      ...Array.from({ length: 6 }, (_, i) => makeAssistantRecord(`a${i}`, { text: `response ${i}` })),
    ]
    const result = extractSessionStateFromTranscript('s1', writeSession(lines))
    expect(result).not.toBeNull()
    expect(result!.originalTask).toBe('Build a REST API for user management')
  })

  it('extracts recent user messages (last 3)', () => {
    const lines = [
      makeUserRecord('1', 'First task'),
      makeAssistantRecord('a1', { text: 'ok' }),
      makeUserRecord('2', 'Second message'),
      makeAssistantRecord('a2', { text: 'ok' }),
      makeUserRecord('3', 'Third message'),
      makeAssistantRecord('a3', { text: 'ok' }),
      makeUserRecord('4', 'Fourth message'),
      makeAssistantRecord('a4', { text: 'ok' }),
      makeUserRecord('5', 'Fifth message'),
      makeAssistantRecord('a5', { text: 'ok' }),
    ]
    const result = extractSessionStateFromTranscript('s1', writeSession(lines))
    expect(result).not.toBeNull()
    expect(result!.recentUserMessages).toHaveLength(3)
    expect(result!.recentUserMessages[0]).toBe('Third message')
    expect(result!.recentUserMessages[2]).toBe('Fifth message')
  })

  it('extracts files modified and read', () => {
    const lines = [
      makeUserRecord('1', 'Fix the bug'),
      ...Array.from({ length: 5 }, (_, i) =>
        makeAssistantRecord(`a${i}`, {
          toolCalls: [
            { name: 'Read', input: { file_path: '/project/src/app.ts' } },
            { name: 'Edit', input: { file_path: '/project/src/utils.ts' } },
          ],
        })
      ),
    ]
    const result = extractSessionStateFromTranscript('s1', writeSession(lines))
    expect(result).not.toBeNull()
    expect(result!.filesModified).toContain('utils.ts')
    expect(result!.filesRead).toContain('app.ts')
  })

  it('extracts git commits', () => {
    const lines = [
      makeUserRecord('1', 'Fix the bug'),
      ...Array.from({ length: 5 }, (_, i) =>
        makeAssistantRecord(`a${i}`, {
          toolCalls: [
            { name: 'Bash', input: { command: 'git commit -m "fix: resolve null pointer bug"' } },
          ],
        })
      ),
    ]
    const result = extractSessionStateFromTranscript('s1', writeSession(lines))
    expect(result).not.toBeNull()
    expect(result!.gitCommits).toContain('fix: resolve null pointer bug')
  })

  it('extracts key bash commands (test, build)', () => {
    const lines = [
      makeUserRecord('1', 'Run tests'),
      ...Array.from({ length: 5 }, (_, i) =>
        makeAssistantRecord(`a${i}`, {
          toolCalls: [
            { name: 'Bash', input: { command: 'npm test' } },
            { name: 'Bash', input: { command: 'npm run build' } },
          ],
        })
      ),
    ]
    const result = extractSessionStateFromTranscript('s1', writeSession(lines))
    expect(result).not.toBeNull()
    expect(result!.keyCommands).toContain('npm test')
    expect(result!.keyCommands).toContain('npm run build')
  })

  it('captures last assistant message', () => {
    const lines = [
      makeUserRecord('1', 'Do something'),
      makeAssistantRecord('a1', { text: 'Working on it...' }),
      makeAssistantRecord('a2', { text: 'Here is the plan:\n1. Step one\n2. Step two' }),
      makeAssistantRecord('a3', { text: 'Done! Next steps:\n1. Run tests\n2. Deploy' }),
      makeAssistantRecord('a4', { text: 'Final message with plan' }),
      makeAssistantRecord('a5', { text: 'ok' }),
    ]
    const result = extractSessionStateFromTranscript('s1', writeSession(lines))
    expect(result).not.toBeNull()
    // Should be the last assistant text message
    expect(result!.lastAssistantMessage).toBe('ok')
  })

  it('returns null for sessions with fewer than 5 turns', () => {
    const lines = [
      makeUserRecord('1', 'Quick question'),
      makeAssistantRecord('a1', { text: 'Answer' }),
      makeAssistantRecord('a2', { text: 'More' }),
    ]
    const result = extractSessionStateFromTranscript('s1', writeSession(lines))
    expect(result).toBeNull()
  })

  it('truncates original task to 300 chars', () => {
    const longTask = 'x'.repeat(500)
    const lines = [
      makeUserRecord('1', longTask),
      ...Array.from({ length: 6 }, (_, i) => makeAssistantRecord(`a${i}`, { text: 'ok' })),
    ]
    const result = extractSessionStateFromTranscript('s1', writeSession(lines))
    expect(result).not.toBeNull()
    expect(result!.originalTask!.length).toBeLessThanOrEqual(303) // 300 + '...'
  })

  it('truncates last assistant message to 500 chars', () => {
    const longMsg = 'y'.repeat(1000)
    const lines = [
      makeUserRecord('1', 'task'),
      ...Array.from({ length: 5 }, (_, i) => makeAssistantRecord(`a${i}`, { text: longMsg })),
    ]
    const result = extractSessionStateFromTranscript('s1', writeSession(lines))
    expect(result).not.toBeNull()
    expect(result!.lastAssistantMessage!.length).toBeLessThanOrEqual(500)
  })
})

describe('saveSessionState and readLastSessionState', () => {
  // These write to ~/.clauditor/ which we can't easily mock
  // Just test the round-trip format

  it('saves and reads markdown format with all sections', () => {
    const data = {
      savedAt: '2026-04-03 15:30',
      branch: 'feat/test',
      cwd: '/home/user/project',
      turns: 50,
      tokensPerTurn: 45,
      wasteFactor: 5,
      filesModified: ['app.ts', 'utils.ts'],
      filesRead: ['config.ts'],
      originalTask: 'Build a REST API',
      recentUserMessages: ['Add pagination', 'Run the tests'],
      gitCommits: ['feat: add pagination endpoint'],
      keyCommands: ['npm test', 'npm run build'],
      lastAssistantMessage: 'Next: deploy to staging',
    }

    saveSessionState(data)
    const content = readLastSessionState()

    expect(content).not.toBeNull()
    expect(content).toContain('feat/test')
    expect(content).toContain('Build a REST API')
    expect(content).toContain('feat: add pagination endpoint')
    expect(content).toContain('npm test')
    expect(content).toContain('Add pagination')
    expect(content).toContain('Next: deploy to staging')
    expect(content).toContain('config.ts')
    expect(content).toContain('## Where We Left Off')
    expect(content).toContain('## Original Task')
    expect(content).toContain('## Commits Made')
    expect(content).toContain('## Key Commands & Results')
    expect(content).toContain('## Recent User Messages')
  })
})
