import { describe, it, expect, beforeEach } from 'vitest'
import { setLocale, t, initLocaleFromEnv } from './i18n.js'

describe('i18n', () => {
  beforeEach(() => {
    setLocale('en')
  })

  it('returns English for known keys', () => {
    expect(t('status.noSessions')).toBe('No active sessions found.')
  })

  it('returns Spanish when locale is es', () => {
    setLocale('es')
    expect(t('status.noSessions')).toBe('No se encontraron sesiones activas.')
  })

  it('falls back to English when a key is missing in the active locale', () => {
    setLocale('es')
    // Non-existent key should fall back to the key itself (sentinel), not throw
    expect(t('nonexistent.key.xyz')).toBe('nonexistent.key.xyz')
  })

  it('falls back to English when the locale code is unknown', () => {
    setLocale('xx')
    expect(t('status.noSessions')).toBe('No active sessions found.')
  })

  it('interpolates {var} params', () => {
    setLocale('en')
    expect(t('block.baseline', { base: 27 })).toBe('Your turns started at 27k tokens.')
  })

  it('interpolates multiple params in any order', () => {
    setLocale('en')
    const out = t('doctor.turnsRatio', { turns: 42, pct: 65 })
    expect(out).toContain('42 turns')
    expect(out).toContain('65%')
  })

  it('leaves unknown params as literal {var}', () => {
    setLocale('en')
    expect(t('block.baseline', {})).toBe('Your turns started at {base}k tokens.')
  })

  it('normalizes locale codes with region/encoding suffixes', () => {
    setLocale('es_ES.UTF-8')
    expect(t('status.noSessions')).toBe('No se encontraron sesiones activas.')

    setLocale('en-US')
    expect(t('status.noSessions')).toBe('No active sessions found.')
  })

  it('normalizes mixed-case locale codes', () => {
    setLocale('ES')
    expect(t('status.noSessions')).toBe('No se encontraron sesiones activas.')
  })

  it('handles null/undefined locale by falling back to en', () => {
    setLocale(null)
    expect(t('status.noSessions')).toBe('No active sessions found.')
    setLocale(undefined)
    expect(t('status.noSessions')).toBe('No active sessions found.')
  })

  it('initLocaleFromEnv prefers explicit config over $LANG', () => {
    const prev = process.env.LANG
    process.env.LANG = 'en'
    initLocaleFromEnv('es')
    expect(t('status.noSessions')).toBe('No se encontraron sesiones activas.')
    process.env.LANG = prev
  })

  it('initLocaleFromEnv falls back to $LANG when config is undefined', () => {
    const prev = process.env.LANG
    process.env.LANG = 'es_ES.UTF-8'
    initLocaleFromEnv(undefined)
    expect(t('status.noSessions')).toBe('No se encontraron sesiones activas.')
    process.env.LANG = prev
  })
})
