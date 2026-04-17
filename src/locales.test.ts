import { describe, it, expect } from 'vitest'
import en from './locales/en.json' with { type: 'json' }
import es from './locales/es.json' with { type: 'json' }

describe('locales key parity', () => {
  const enKeys = Object.keys(en).sort()
  const esKeys = Object.keys(es).sort()

  it('es has every en key (no missing translations)', () => {
    const missing = enKeys.filter((k) => !(k in es))
    expect(missing).toEqual([])
  })

  it('es has no extra keys not present in en (no dead translations)', () => {
    const extra = esKeys.filter((k) => !(k in en))
    expect(extra).toEqual([])
  })

  it('every es value is a string', () => {
    for (const [key, value] of Object.entries(es)) {
      expect(typeof value, `es.${key}`).toBe('string')
    }
  })

  it('interpolation placeholders match between en and es', () => {
    // Every {var} in en[k] must also appear in es[k], and vice versa.
    // Catches translations that drop or invent params, which would render broken strings.
    const placeholderRe = /\{(\w+)\}/g
    const extract = (s: string): Set<string> => new Set([...s.matchAll(placeholderRe)].map((m) => m[1]))

    for (const key of enKeys) {
      const enVars = extract((en as Record<string, string>)[key])
      const esVars = extract((es as Record<string, string>)[key])
      expect([...enVars].sort(), `placeholders in "${key}"`).toEqual([...esVars].sort())
    }
  })
})
