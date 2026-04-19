import { describe, it, expect } from 'vitest'
import { normalizeToolResponse } from './post-tool-use.js'

describe('normalizeToolResponse', () => {
  describe('string inputs (legacy tools)', () => {
    it('returns strings unchanged', () => {
      expect(normalizeToolResponse('hello world')).toBe('hello world')
    })

    it('returns empty string unchanged', () => {
      expect(normalizeToolResponse('')).toBe('')
    })

    it('preserves multi-line strings', () => {
      expect(normalizeToolResponse('line1\nline2')).toBe('line1\nline2')
    })
  })

  describe('falsy inputs', () => {
    it('returns empty string for null', () => {
      expect(normalizeToolResponse(null)).toBe('')
    })

    it('returns empty string for undefined', () => {
      expect(normalizeToolResponse(undefined)).toBe('')
    })

    it('returns empty string for missing field', () => {
      // Simulates input.tool_response being absent
      const input: { tool_response?: unknown } = {}
      expect(normalizeToolResponse(input.tool_response)).toBe('')
    })
  })

  describe('Bash tool_response object (real Claude Code structure)', () => {
    it('serializes the full Bash response shape', () => {
      const bashResponse = {
        stdout: 'file1\nfile2',
        stderr: '',
        interrupted: false,
        isImage: false,
        returnCodeInterpretation: '',
        noOutputExpected: false,
      }
      const result = normalizeToolResponse(bashResponse)
      expect(typeof result).toBe('string')
      expect(result).toContain('"stdout":"file1\\nfile2"')
      expect(result).toContain('"stderr":""')
    })

    it('keeps error keywords matchable via .includes', () => {
      // Regression: downstream code relies on toolResponse.includes('error')
      // to route error events to hubPush. The normalized JSON string must
      // still expose these substrings when the object contains them.
      const bashError = {
        stdout: '',
        stderr: 'cat: missing: No such file or directory',
        interrupted: false,
        isImage: false,
        returnCodeInterpretation: 'error',
        noOutputExpected: false,
      }
      const result = normalizeToolResponse(bashError)
      expect(result.includes('error')).toBe(true)
    })

    it('keeps FAILED keyword matchable', () => {
      const buildFailure = {
        stdout: '',
        stderr: 'Build FAILED in 3.2s',
        interrupted: false,
        isImage: false,
        returnCodeInterpretation: '',
        noOutputExpected: false,
      }
      const result = normalizeToolResponse(buildFailure)
      expect(result.includes('FAILED')).toBe(true)
    })

    it('produces a string with a computable length (>= 500 threshold)', () => {
      // Regression: toolResponse.length was undefined for objects, bypassing
      // the compression threshold entirely.
      const bigResponse = {
        stdout: 'x'.repeat(600),
        stderr: '',
      }
      const result = normalizeToolResponse(bigResponse)
      expect(typeof result.length).toBe('number')
      expect(result.length).toBeGreaterThanOrEqual(500)
    })

    it('supports .slice() for error_message capture', () => {
      const response = { stderr: 'some error output' }
      const result = normalizeToolResponse(response)
      expect(() => result.slice(0, 200)).not.toThrow()
      expect(result.slice(0, 10)).toBe(result.substring(0, 10))
    })
  })

  describe('edge cases', () => {
    it('serializes booleans', () => {
      expect(normalizeToolResponse(true)).toBe('true')
      expect(normalizeToolResponse(false)).toBe('')
    })

    it('serializes numbers', () => {
      expect(normalizeToolResponse(42)).toBe('42')
      expect(normalizeToolResponse(0)).toBe('')
    })

    it('serializes arrays', () => {
      expect(normalizeToolResponse(['a', 'b'])).toBe('["a","b"]')
    })

    it('falls back to String() on circular references', () => {
      const circular: Record<string, unknown> = { name: 'x' }
      circular.self = circular
      const result = normalizeToolResponse(circular)
      // Must not throw; shape of fallback is implementation-defined but
      // must be a string.
      expect(typeof result).toBe('string')
    })
  })
})
