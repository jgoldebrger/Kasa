/**
 * Translation catalog — locale JSON files under ./messages/.
 *
 * Only `en-US` is bundled in the main chunk. Other locales load on demand
 * via `loadLocaleMessages()` in ./load-locale.ts.
 */

export { type MessageKey, loadLocaleMessages, getCachedLocaleMessages, primeLocaleMessages } from './load-locale'

import enUS from './messages/en-US.json'

/** @deprecated Prefer loadLocaleMessages — kept for type exports only. */
export const messages = {
  'en-US': enUS,
} as const
