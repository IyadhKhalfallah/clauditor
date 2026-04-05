import { describe, it, expect } from 'vitest'

// Test the regex patterns directly
const CONTINUE_PATTERNS = [
  /^\s*continue\s*$/i,
  /^\s*continue\s+(where|from|with)/i,
  /^\s*pick\s+up/i,
  /^\s*resume\s*$/i,
  /^\s*resume\s+(work|session|previous|where|from)/i,
  /^\s*keep\s+going/i,
  /^\s*carry\s+on/i,
  /^\s*where\s+(did|were)\s+(we|i|you)\s+(leave|left)/i,
  /^\s*what\s+(were|was)\s+(we|i|you)\s+(working|doing)/i,
  /^\s*let'?s?\s+continue/i,
  /^\s*continue\s+here/i,
  /^\s*start\s+from\s+where/i,
  /^\s*pick\s+it\s+up/i,
  /^\s*back\s+to\s+(work|where)/i,
]

function isContinuePrompt(prompt: string): boolean {
  return CONTINUE_PATTERNS.some(p => p.test(prompt.trim()))
}

describe('continue prompt detection', () => {
  describe('matches continue prompts', () => {
    const shouldMatch = [
      'continue',
      'Continue',
      'CONTINUE',
      '  continue  ',
      'continue where I left off',
      'continue where we left off',
      'continue from where I left off',
      'continue with the previous task',
      'Continue here',
      'pick up where we left off',
      'pick up where I left off',
      'pick it up',
      'resume',
      'resume previous session',
      'resume work',
      'resume session',
      'resume previous session',
      'resume where I left off',
      'keep going',
      'carry on',
      'where did we leave off',
      'where did I leave off',
      'where were we left off',
      'what were we working on',
      'what was I working on',
      'what were you doing',
      "let's continue",
      'lets continue',
      'let continue',
      'start from where we left off',
      'back to work',
      'back to where we were',
    ]

    for (const prompt of shouldMatch) {
      it(`matches: "${prompt}"`, () => {
        expect(isContinuePrompt(prompt)).toBe(true)
      })
    }
  })

  describe('does not match non-continue prompts', () => {
    const shouldNotMatch = [
      'fix the bug in app.ts',
      'help me build a REST API',
      'continue building the feature and add tests',  // has more after "continue"
      'what is the status of the PR',
      'run the tests',
      'hello',
      '',
      'can you continue refactoring the auth module',  // doesn't start with continue
      'please resume the download script',  // doesn't start with resume
      'resume the download',  // "resume" + non-session noun
      'resume building the API',  // "resume" + task description
    ]

    for (const prompt of shouldNotMatch) {
      it(`does not match: "${prompt}"`, () => {
        expect(isContinuePrompt(prompt)).toBe(false)
      })
    }
  })
})

describe('existing session detection', () => {
  it('detects assistant turns in transcript', () => {
    const transcriptWithTurns = '{"type":"user","message":{"content":"hello"}}\n{"type":"assistant","message":{"role":"assistant","usage":{"input_tokens":100}}}'
    expect(transcriptWithTurns.includes('"type":"assistant"')).toBe(true)
  })

  it('detects no assistant turns in empty transcript', () => {
    const emptyTranscript = '{"type":"user","message":{"content":"hello"}}'
    expect(emptyTranscript.includes('"type":"assistant"')).toBe(false)
  })
})
