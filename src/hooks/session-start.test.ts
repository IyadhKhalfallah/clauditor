import { describe, it, expect } from 'vitest'
import { sessionStartOutput } from './session-start.js'

describe('sessionStartOutput', () => {
  it('nests the context under hookSpecificOutput', () => {
    expect(sessionStartOutput({ additionalContext: 'Previous session: fix the parser.' })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: 'Previous session: fix the parser.',
      },
    })
  })

  it('writes an empty object when there is no context', () => {
    expect(sessionStartOutput({})).toEqual({})
    expect(sessionStartOutput({ additionalContext: '' })).toEqual({})
  })
})
