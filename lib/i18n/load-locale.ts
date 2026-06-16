import type { Locale } from '@/lib/client/i18n'
import enUS from './messages/en-US.json'

export type MessageKey = keyof typeof enUS

const cache: Partial<Record<Locale, Record<string, string>>> = {
  'en-US': enUS as Record<string, string>,
}

/**
 * Load translation messages for a locale. `en-US` is bundled; other
 * locales are code-split and fetched on demand.
 */
export async function loadLocaleMessages(locale: Locale): Promise<Record<string, string>> {
  if (cache[locale]) return cache[locale]!

  let messages: Record<string, string>
  switch (locale) {
    case 'en-GB':
      messages = (await import('./messages/en-GB.json')).default as Record<string, string>
      break
    case 'he-IL':
      messages = (await import('./messages/he-IL.json')).default as Record<string, string>
      break
    case 'yi':
      messages = (await import('./messages/yi.json')).default as Record<string, string>
      break
    case 'fr-FR':
      messages = (await import('./messages/fr-FR.json')).default as Record<string, string>
      break
    case 'es-MX':
      messages = (await import('./messages/es-MX.json')).default as Record<string, string>
      break
    default:
      messages = enUS as Record<string, string>
  }
  cache[locale] = messages
  return messages
}

/** Synchronous read — only guaranteed for en-US until async load completes. */
export function getCachedLocaleMessages(locale: Locale): Record<string, string> | undefined {
  return cache[locale]
}

export function primeLocaleMessages(locale: Locale, messages: Record<string, string>): void {
  cache[locale] = messages
}
