import en from './locales/en.json'
import es from './locales/es.json'

type Messages = Record<string, string>

const BUNDLES: Record<string, Messages> = {
  en: en as Messages,
  es: es as Messages,
}

let active: Messages = BUNDLES.en

function normalize(code: string | undefined | null): string {
  if (!code) return 'en'
  const lower = code.toLowerCase().split(/[_.-]/)[0]
  return BUNDLES[lower] ? lower : 'en'
}

export function setLocale(code: string | undefined | null): void {
  active = BUNDLES[normalize(code)]
}

export function initLocaleFromEnv(configLocale?: string): void {
  setLocale(configLocale ?? process.env.LANG ?? 'en')
}

export function t(key: string, params?: Record<string, string | number>): string {
  let str = active[key] ?? (BUNDLES.en as Messages)[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, String(v))
    }
  }
  return str
}
