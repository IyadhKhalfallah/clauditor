import { describe, it, expect } from 'vitest'
import { parseStructuredHandoff } from './session-state.js'

describe('parseStructuredHandoff', () => {
  it('parses a fully structured handoff', () => {
    const text = `
This session is at 10x quota burn. Start fresh.

TASK: Fixing Clerk theme contrast on dark background

COMPLETED:
- Updated colorTextSecondary from #9898b0 to #b8b8d0
- Changed all borders from #1e1e30 to #2a2a42
- Added dividerLine and dividerText styles

IN_PROGRESS:
- Deploying to Railway via railway up --detach

FAILED_APPROACHES:
- Tried inline styles for Clerk components — Clerk's SDK overrides them at runtime
- Tried using CSS variables in globals.css — Clerk doesn't read CSS custom properties

DEPENDENCIES:
- Must run drizzle-kit push before npm run build
- Clerk production requires custom Google OAuth credentials, not shared ones

DECISIONS:
- Chose #f09040 for primary orange (brighter than #e8863a for contrast on dark bg)
- Used railway up --detach instead of git push for deploys

USER_PREFERENCES:
- Don't add co-author lines to commits
- Don't add emojis to code

BLOCKERS:
- OG images still reference localhost — need NEXT_PUBLIC_APP_URL update

[clauditor-rotation]
    `

    const result = parseStructuredHandoff(text)
    expect(result.isStructured).toBe(true)
    expect(result.task).toBe('Fixing Clerk theme contrast on dark background')
    expect(result.completed).toHaveLength(3)
    expect(result.completed[0]).toContain('colorTextSecondary')
    expect(result.inProgress).toHaveLength(1)
    expect(result.failedApproaches).toHaveLength(2)
    expect(result.failedApproaches[0]).toContain('inline styles')
    expect(result.failedApproaches[1]).toContain('CSS variables')
    expect(result.dependencies).toHaveLength(2)
    expect(result.dependencies[0]).toContain('drizzle-kit push')
    expect(result.decisions).toHaveLength(2)
    expect(result.decisions[0]).toContain('#f09040')
    expect(result.userPreferences).toHaveLength(2)
    expect(result.userPreferences[0]).toContain('co-author')
    expect(result.blockers).toHaveLength(1)
    expect(result.blockers[0]).toContain('OG images')
  })

  it('returns isStructured=false for plain prose', () => {
    const text = `
This session is at 5x quota burn.

We were working on the Clerk theme. Fixed the colors.
Next step is to deploy.

[clauditor-rotation]
    `
    const result = parseStructuredHandoff(text)
    expect(result.isStructured).toBe(false)
  })

  it('returns isStructured=false when only 1 section is present', () => {
    const text = `
TASK: Working on something

Everything else is just prose without any section headers.
    `
    const result = parseStructuredHandoff(text)
    expect(result.isStructured).toBe(false)
  })

  it('handles partial structure (some sections missing)', () => {
    const text = `
TASK: Deploy to Railway

COMPLETED:
- Database migrated
- Env vars configured

BLOCKERS:
- Custom domain SSL not ready yet

[clauditor-rotation]
    `
    const result = parseStructuredHandoff(text)
    expect(result.isStructured).toBe(true)
    expect(result.task).toBe('Deploy to Railway')
    expect(result.completed).toHaveLength(2)
    expect(result.blockers).toHaveLength(1)
    expect(result.failedApproaches).toHaveLength(0)
    expect(result.decisions).toHaveLength(0)
  })

  it('captures remainder text outside sections', () => {
    const text = `
This session was productive.

TASK: Fix authentication

COMPLETED:
- OAuth configured

Some additional context that doesn't belong to any section.

[clauditor-rotation]
    `
    const result = parseStructuredHandoff(text)
    expect(result.isStructured).toBe(true)
    expect(result.remainder).toContain('productive')
    // "additional context" appears after COMPLETED section — it's captured as remainder
    // only if it's not a bullet item (which it isn't)
  })

  it('handles non-English content in sections', () => {
    const text = `
TASK: Correction du theme Clerk

COMPLETED:
- Mise a jour des couleurs du theme sombre
- Ajout des styles pour le diviseur

FAILED_APPROACHES:
- Essaye les styles inline — Clerk les remplace au runtime

DEPENDENCIES:
- Il faut lancer les migrations avant le build

[clauditor-rotation]
    `
    const result = parseStructuredHandoff(text)
    expect(result.isStructured).toBe(true)
    expect(result.task).toBe('Correction du theme Clerk')
    expect(result.completed).toHaveLength(2)
    expect(result.failedApproaches).toHaveLength(1)
    expect(result.failedApproaches[0]).toContain('styles inline')
    expect(result.dependencies).toHaveLength(1)
  })

  it('handles bullet items with * instead of -', () => {
    const text = `
TASK: Setup

COMPLETED:
* First thing done
* Second thing done

BLOCKERS:
* Waiting for API key

[clauditor-rotation]
    `
    const result = parseStructuredHandoff(text)
    expect(result.isStructured).toBe(true)
    expect(result.completed).toHaveLength(2)
    expect(result.blockers).toHaveLength(1)
  })
})
