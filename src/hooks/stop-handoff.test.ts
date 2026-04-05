import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Test the detection logic directly
function isRotationHandoff(msg: string): boolean {
  if (!msg || msg.length < 100) return false
  return (
    msg.includes('[clauditor-rotation]') ||
    (msg.includes('burning') && msg.includes('quota')) ||
    (msg.includes('progress') && msg.includes('saved') && msg.includes('session')) ||
    (msg.includes('fresh session') && msg.includes('tokens/turn'))
  )
}

describe('Stop hook rotation handoff capture', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clauditor-stop-test-'))
  })

  afterEach(() => {
    vi.doUnmock('node:os')
    vi.resetModules()
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('marker-based detection', () => {
    it('detects [clauditor-rotation] marker', () => {
      const msg = 'This session is at 5x waste. Here is where we are and what to do next. ' +
        'Step 1 done, step 2 in progress. Run claude to start fresh. [clauditor-rotation]'
      expect(isRotationHandoff(msg)).toBe(true)
    })
  })

  describe('fallback AND-pair detection', () => {
    it('detects "burning" + "quota"', () => {
      const msg = 'This session is burning 5x more quota than necessary. ' +
        'Your progress has been saved. Here is the current state of the migration work and what remains to be done for the next session.'
      expect(isRotationHandoff(msg)).toBe(true)
    })

    it('detects "progress" + "saved" + "session"', () => {
      const msg = 'Your session progress has been saved and won\'t be lost. ' +
        'The migration is halfway through. Steps completed: 1-4. Steps remaining: 5-8. Start a fresh session to continue.'
      expect(isRotationHandoff(msg)).toBe(true)
    })

    it('detects "fresh session" + "tokens/turn"', () => {
      const msg = 'I recommend starting a fresh session. You\'ll be back to ~20k tokens/turn instead of 170k tokens/turn. ' +
        'Here is what we were working on and the detailed plan for continuing the work.'
      expect(isRotationHandoff(msg)).toBe(true)
    })
  })

  describe('does not false-trigger on normal responses', () => {
    it('ignores normal coding responses with "next steps"', () => {
      const msg = 'Here is the refactored auth module. Next steps: run the test suite and check for regressions. ' +
        'I also updated the middleware to handle edge cases properly.'
      expect(isRotationHandoff(msg)).toBe(false)
    })

    it('ignores responses with "where we are"', () => {
      const msg = 'Let me explain where we are in the refactoring. The service layer is done, ' +
        'the controller needs updating, and the tests need to be written for the new endpoints.'
      expect(isRotationHandoff(msg)).toBe(false)
    })

    it('ignores responses with "what\'s done"', () => {
      const msg = 'Here is what\'s done so far: the database migration is complete, the API endpoints are updated, ' +
        'and the frontend components are rendering correctly with the new data format.'
      expect(isRotationHandoff(msg)).toBe(false)
    })

    it('ignores short messages', () => {
      const msg = 'Done!'
      expect(isRotationHandoff(msg)).toBe(false)
    })

    it('ignores empty messages', () => {
      expect(isRotationHandoff('')).toBe(false)
    })

    it('ignores "progress saved" without "session"', () => {
      const msg = 'Your progress has been saved to the database. The batch job completed successfully ' +
        'and all 500 records were processed without errors in the latest run.'
      expect(isRotationHandoff(msg)).toBe(false)
    })
  })

  describe('saves handoff when detected', () => {
    it('saves rotation summary as PostCompact-style per-session file', async () => {
      vi.resetModules()
      vi.doMock('node:os', () => ({ homedir: () => tempDir }))
      const { savePostCompactSummary, readRecentHandoffs } = await import('../features/session-state.js')

      const summary = 'This session is burning 5x more quota than necessary. ' +
        'Your progress has been saved. Run claude to start a fresh session. ' +
        'Where we are: Step 3 of 5 complete. Next: deploy to staging. [clauditor-rotation]'

      savePostCompactSummary(summary, '/home/user/project')

      const handoffs = readRecentHandoffs('/home/user/project')
      expect(handoffs.length).toBe(1)
      expect(handoffs[0].content).toContain('burning 5x')
      expect(handoffs[0].content).toContain('deploy to staging')
      expect(handoffs[0].isPostCompact).toBe(true)
    })

    it('does not save when message is not a rotation handoff', async () => {
      vi.resetModules()
      vi.doMock('node:os', () => ({ homedir: () => tempDir }))
      const { savePostCompactSummary, readRecentHandoffs } = await import('../features/session-state.js')

      // This is a normal message — should NOT be saved by the stop hook
      // (we only call savePostCompactSummary when isRotationHandoff is true)
      const normalMsg = 'Here is the refactored code. The tests pass and the build is clean.'
      expect(isRotationHandoff(normalMsg)).toBe(false)

      const handoffs = readRecentHandoffs('/home/user/project')
      expect(handoffs.length).toBe(0)
    })
  })
})
