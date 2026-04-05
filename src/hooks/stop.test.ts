import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { analyzeForLoop } from './stop.js'
import type { StopHookInput } from '../types.js'

function makeStopInput(transcriptPath: string, overrides: Partial<StopHookInput> = {}): StopHookInput {
  return {
    session_id: 'test-session-1234',
    transcript_path: transcriptPath,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: 'Done.',
    ...overrides,
  }
}

function makeAssistantRecord(
  toolCalls: { name: string; input: unknown }[],
  index: number = 0,
): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: `a-${index}`,
    sessionId: 's1',
    timestamp: `2026-04-03T10:0${index}:00Z`,
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: toolCalls.map((tc, i) => ({
        type: 'tool_use',
        id: `tu_${index}_${i}`,
        name: tc.name,
        input: tc.input,
      })),
    },
  })
}

function makeUserRecord(index: number = 0): string {
  return JSON.stringify({
    type: 'user',
    uuid: `u-${index}`,
    sessionId: 's1',
    timestamp: `2026-04-03T10:0${index}:00Z`,
    message: { role: 'user', content: 'hello' },
  })
}

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'stop-hook-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function writeTranscript(lines: string[]): string {
  const filePath = join(tmpDir, 'transcript.jsonl')
  writeFileSync(filePath, lines.join('\n'))
  return filePath
}

describe('analyzeForLoop', () => {
  it('returns empty decision when 3 different assistant turns have different tool calls', () => {
    const path = writeTranscript([
      makeAssistantRecord([{ name: 'Bash', input: { command: 'npm test' } }], 0),
      makeAssistantRecord([{ name: 'Bash', input: { command: 'npm run build' } }], 1),
      makeAssistantRecord([{ name: 'Read', input: { file: 'src/index.ts' } }], 2),
    ])
    const result = analyzeForLoop(makeStopInput(path))
    expect(result.decision).toBeUndefined()
  })

  it('blocks after 3 identical assistant turns', () => {
    const toolCall = { name: 'Bash', input: { command: 'npm test' } }
    const path = writeTranscript([
      makeAssistantRecord([toolCall], 0),
      makeAssistantRecord([toolCall], 1),
      makeAssistantRecord([toolCall], 2),
    ])
    const result = analyzeForLoop(makeStopInput(path))
    expect(result.decision).toBe('block')
    expect(result.reason).toContain('Loop detected')
    expect(result.reason).toContain('Bash')
  })

  it('blocks after 4 identical assistant turns', () => {
    const toolCall = { name: 'Bash', input: { command: 'npm test' } }
    const path = writeTranscript([
      makeAssistantRecord([toolCall], 0),
      makeAssistantRecord([toolCall], 1),
      makeAssistantRecord([toolCall], 2),
      makeAssistantRecord([toolCall], 3),
    ])
    const result = analyzeForLoop(makeStopInput(path))
    expect(result.decision).toBe('block')
    expect(result.reason).toContain('4 times')
  })

  it('does not block with only 2 identical turns', () => {
    const toolCall = { name: 'Bash', input: { command: 'npm test' } }
    const path = writeTranscript([
      makeAssistantRecord([{ name: 'Read', input: { file: 'foo.ts' } }], 0),
      makeAssistantRecord([toolCall], 1),
      makeAssistantRecord([toolCall], 2),
    ])
    const result = analyzeForLoop(makeStopInput(path))
    expect(result.decision).toBeUndefined()
  })

  it('handles empty transcript gracefully', () => {
    const path = writeTranscript([])
    const result = analyzeForLoop(makeStopInput(path))
    expect(result.decision).toBeUndefined()
  })

  it('handles missing transcript file gracefully', () => {
    const result = analyzeForLoop(makeStopInput('/nonexistent/path/transcript.jsonl'))
    expect(result.decision).toBeUndefined()
  })

  it('returns empty decision when transcript has only user records', () => {
    const path = writeTranscript([
      makeUserRecord(0),
      makeUserRecord(1),
      makeUserRecord(2),
      makeUserRecord(3),
    ])
    const result = analyzeForLoop(makeStopInput(path))
    expect(result.decision).toBeUndefined()
  })

  it('detects loop at end of mixed turns', () => {
    const loopCall = { name: 'Bash', input: { command: 'npm test' } }
    const path = writeTranscript([
      makeUserRecord(0),
      makeAssistantRecord([{ name: 'Read', input: { file: 'src/index.ts' } }], 0),
      makeUserRecord(1),
      makeAssistantRecord([{ name: 'Edit', input: { file: 'src/app.ts' } }], 1),
      makeUserRecord(2),
      makeAssistantRecord([loopCall], 2),
      makeAssistantRecord([loopCall], 3),
      makeAssistantRecord([loopCall], 4),
    ])
    const result = analyzeForLoop(makeStopInput(path))
    expect(result.decision).toBe('block')
    expect(result.reason).toContain('Bash')
  })

  it('does not detect loop when tool names match but inputs differ', () => {
    const path = writeTranscript([
      makeAssistantRecord([{ name: 'Bash', input: { command: 'npm test' } }], 0),
      makeAssistantRecord([{ name: 'Bash', input: { command: 'npm run lint' } }], 1),
      makeAssistantRecord([{ name: 'Bash', input: { command: 'npm run build' } }], 2),
    ])
    const result = analyzeForLoop(makeStopInput(path))
    expect(result.decision).toBeUndefined()
  })

  it('handles malformed JSONL lines without crashing', () => {
    const toolCall = { name: 'Bash', input: { command: 'npm test' } }
    const path = writeTranscript([
      'not valid json',
      makeAssistantRecord([toolCall], 0),
      '{broken',
      makeAssistantRecord([toolCall], 1),
      makeAssistantRecord([toolCall], 2),
    ])
    const result = analyzeForLoop(makeStopInput(path))
    expect(result.decision).toBe('block')
  })
})
