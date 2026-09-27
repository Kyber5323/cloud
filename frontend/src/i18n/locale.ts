/**
 * The locale vocabulary shared by the i18n instance, the resource bundles and
 * every language-aware component.
 *
 * `zh-CN` is the product's original language and stays the default; `en-US` is
 * the second language the workflow port carries over from the desktop app.
 * The storage key matches the desktop app's, so a member who uses both sees the
 * same language in each.
 */

/** A language the application ships translations for. */
export type Locale = 'zh-CN' | 'en-US'

/** Every supported locale, in the order a language picker lists them. */
export const LOCALES: readonly Locale[] = ['zh-CN', 'en-US']

/** Locale applied before the member chooses one, and the fallback for a missing key. */
export const DEFAULT_LOCALE: Locale = 'zh-CN'

/** Storage key holding the member's chosen locale. */
const LOCALE_STORAGE_KEY = 'ora.locale'

/**
 * Narrows an untrusted value (stored, or from a URL) to a supported locale.
 *
 * @param value - Candidate read from storage or a query parameter.
 * @returns Whether `value` is a locale the bundles cover.
 */
export function isLocale(value: unknown): value is Locale {
  return value === 'zh-CN' || value === 'en-US'
}

/**
 * Reads the persisted locale. Storage being unavailable (private mode, blocked
 * cookies) is not a startup failure: the default locale applies instead.
 *
 * @returns The stored locale, or {@link DEFAULT_LOCALE}.
 */
export function storedLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    return isLocale(stored) ? stored : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

/**
 * Persists the locale for the next visit. A rejected write is swallowed: the
 * switch still applies to the running tab.
 *
 * @param locale - Locale to remember.
 */
export function rememberLocale(locale: Locale): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Storage is an enhancement; the language switch still works in this tab.
  }
}

/**
 * Reflects the locale on `<html lang>` so the browser picks the matching font
 * stack, line-breaking rules and spell-checking dictionary.
 *
 * @param locale - Locale to declare on the document element.
 */
export function applyDocumentLanguage(locale: Locale): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale
}
