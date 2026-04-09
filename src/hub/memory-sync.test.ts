import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readAutoMemory } from './memory-sync.js'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

// Use a temp directory to simulate Claude's memory structure
const TEST_PROJECT_PATH = '/tmp/test-clauditor-memory-project'
const ENCODED_PATH = TEST_PROJECT_PATH.replace(/[^a-zA-Z0-9]/g, '-')
const CLAUDE_MEMORY_DIR = resolve(homedir(), '.claude', 'projects', ENCODED_PATH, 'memory')

describe('readAutoMemory', () => {
  beforeEach(() => {
    mkdirSync(CLAUDE_MEMORY_DIR, { recursive: true })
  })

  afterEach(() => {
    try { rmSync(resolve(homedir(), '.claude', 'projects', ENCODED_PATH), { recursive: true }) } catch {}
  })

  it('reads memory files with frontmatter', () => {
    writeFileSync(resolve(CLAUDE_MEMORY_DIR, 'feedback_testing.md'), `---
name: Testing approach
description: Use integration tests over mocks
type: feedback
---

Always use real DB connections in integration tests.

**Why:** Mock tests passed but prod migration failed.
**How to apply:** Never mock the database layer.
`)

    writeFileSync(resolve(CLAUDE_MEMORY_DIR, 'project_deadline.md'), `---
name: Release deadline
description: Feature freeze on 2026-04-15
type: project
---

Feature freeze begins 2026-04-15 for v2.0 release.
`)

    // MEMORY.md should be excluded
    writeFileSync(resolve(CLAUDE_MEMORY_DIR, 'MEMORY.md'), `# Memory Index
- [Testing](feedback_testing.md)
- [Deadline](project_deadline.md)
`)

    const entries = readAutoMemory(TEST_PROJECT_PATH)
    expect(entries.length).toBe(2)

    const feedback = entries.find(e => e.memory_type === 'feedback')
    expect(feedback).toBeDefined()
    expect(feedback!.name).toBe('Testing approach')
    expect(feedback!.scope).toBe('team')
    expect(feedback!.content).toContain('real DB connections')
    expect(feedback!.content_hash).toHaveLength(32)

    const project = entries.find(e => e.memory_type === 'project')
    expect(project).toBeDefined()
    expect(project!.name).toBe('Release deadline')
  })

  it('scopes user-type memories as developer', () => {
    writeFileSync(resolve(CLAUDE_MEMORY_DIR, 'user_prefs.md'), `---
name: User preferences
description: Prefers terse responses
type: user
---

Prefers short, direct responses with no trailing summaries.
`)

    const entries = readAutoMemory(TEST_PROJECT_PATH)
    expect(entries.length).toBe(1)
    expect(entries[0].scope).toBe('developer')
  })

  it('skips files without proper frontmatter', () => {
    writeFileSync(resolve(CLAUDE_MEMORY_DIR, 'broken.md'), `No frontmatter here
Just some text.
`)

    const entries = readAutoMemory(TEST_PROJECT_PATH)
    expect(entries.length).toBe(0)
  })

  it('skips files with empty body', () => {
    writeFileSync(resolve(CLAUDE_MEMORY_DIR, 'empty.md'), `---
name: Empty entry
description: Nothing here
type: feedback
---
`)

    const entries = readAutoMemory(TEST_PROJECT_PATH)
    expect(entries.length).toBe(0)
  })

  it('returns empty for non-existent project', () => {
    const entries = readAutoMemory('/tmp/no-such-project-ever')
    expect(entries.length).toBe(0)
  })

  it('scrubs secrets from content', () => {
    // Construct fake secret at runtime to avoid GitHub push protection
    const fakeKey = 'sk' + '_live_' + 'abc123def456ghi789jklmnopqrstuvwxyz'
    writeFileSync(resolve(CLAUDE_MEMORY_DIR, 'ref_api.md'), `---
name: API keys
description: How to use the API
type: reference
---

Use the Stripe API with key ${fakeKey} for production.
`)

    const entries = readAutoMemory(TEST_PROJECT_PATH)
    expect(entries.length).toBe(1)
    expect(entries[0].content).not.toContain('sk_live_')
    expect(entries[0].content).toContain('[REDACTED')
  })

  it('produces deterministic content hashes', () => {
    writeFileSync(resolve(CLAUDE_MEMORY_DIR, 'stable.md'), `---
name: Stable entry
description: Hash should not change
type: reference
---

Same content every time.
`)

    const entries1 = readAutoMemory(TEST_PROJECT_PATH)
    const entries2 = readAutoMemory(TEST_PROJECT_PATH)
    expect(entries1[0].content_hash).toBe(entries2[0].content_hash)
  })
})
