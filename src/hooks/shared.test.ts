import { describe, it, expect, vi, afterEach } from 'vitest'
import { outputDecision, toolResponseText } from './shared.js'

describe('outputDecision', () => {
  afterEach(() => { vi.restoreAllMocks() })

  function captured(...args: Parameters<typeof outputDecision>): unknown {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    outputDecision(...args)
    return JSON.parse(String(write.mock.calls[0][0]))
  }

  it('keeps the legacy top-level shape without an event name', () => {
    expect(captured({ additionalContext: 'ctx' })).toEqual({ additionalContext: 'ctx' })
  })

  it('writes {} for an empty decision even with an event name', () => {
    expect(captured({}, 'PostToolUse')).toEqual({})
  })

  it('nests context under hookSpecificOutput for PostToolUse', () => {
    expect(captured({ additionalContext: 'ctx', reason: 'r' }, 'PostToolUse')).toEqual({
      reason: 'r',
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'ctx' },
    })
  })
})

describe('toolResponseText', () => {
  it('passes strings through', () => {
    expect(toolResponseText('file contents')).toBe('file contents')
  })

  it('joins Bash stdout and stderr', () => {
    expect(toolResponseText({ stdout: 'out', stderr: 'npm ERR! missing script', interrupted: false }))
      .toBe('out\nnpm ERR! missing script')
  })

  it('skips empty streams', () => {
    expect(toolResponseText({ stdout: '', stderr: 'boom' })).toBe('boom')
    expect(toolResponseText({ stdout: 'ok', stderr: '' })).toBe('ok')
  })

  it('returns empty text for a Bash result with no output', () => {
    expect(toolResponseText({ stdout: '', stderr: '', interrupted: false })).toBe('')
  })

  it('serializes other object responses', () => {
    expect(toolResponseText({ filePath: '/a', success: true })).toBe('{"filePath":"/a","success":true}')
  })

  it('returns empty text for missing or non-object values', () => {
    expect(toolResponseText(undefined)).toBe('')
    expect(toolResponseText(null)).toBe('')
    expect(toolResponseText(42)).toBe('')
  })
})
