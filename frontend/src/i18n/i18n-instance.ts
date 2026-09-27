/**
 * The application's i18next instance and its lifecycle.
 *
 * {@link initI18n} creates the instance, binds it to react-i18next so
 * `useTranslation()` works anywhere without a provider, and applies the stored
 * locale. It is called once from the application entry point (and from the
 * test setup, which mounts pages directly), and is idempotent so a second call
 * is harmless.
 *
 * Scope: the resources currently cover the workflow feature only, because the
 * rest of the interface is still Chinese-only. The instance is a normal
 * app-wide one, so widening the coverage is a matter of adding bundles to
 * {@link featureTranslationResources} — no call site changes.
 */
import { createInstance, type i18n as I18n } from 'i18next'
import { initReactI18next } from 'react-i18next'
import {
  applyDocumentLanguage,
  isLocale,
  rememberLocale,
  storedLocale,
  type Locale,
} from '@/i18n/locale'
import { translationResources } from '@/i18n/resources'

/**
 * Keys the composed bundles declare. A component asking for anything else
 * fails the type check rather than rendering the raw key.
 */
export type TranslationKey = keyof (typeof translationResources)['zh-CN']

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    // The composed map is keyed by the union of declared keys, so `t` accepts
    // exactly those keys and rejects a typo at the call site.
    resources: { translation: (typeof translationResources)['zh-CN'] }
  }
}

let instance: I18n | undefined

/**
 * Initializes the shared i18next instance, or returns the existing one.
 *
 * @returns The application's i18next instance.
 */
export function initI18n(): I18n {
  if (instance) return instance
  const i18n = createInstance()
  const initialLocale = storedLocale()
  void i18n.use(initReactI18next).init({
    resources: {
      'zh-CN': { translation: translationResources['zh-CN'] },
      'en-US': { translation: translationResources['en-US'] },
    },
    lng: initialLocale,
    fallbackLng: 'zh-CN',
    supportedLngs: ['zh-CN', 'en-US'],
    // Keys are flat and dot-namespaced, so the separator must stay off: with it
    // on, `workflows.node.agent.label` would be read as a nested path and miss.
    keySeparator: false,
    interpolation: { escapeValue: false },
    // The bundles are in the initial call, so there is nothing to await.
    // Leaving this on would render the first frame with unresolved keys.
    initAsync: false,
  })
  applyDocumentLanguage(initialLocale)
  i18n.on('languageChanged', (language: string) => {
    const locale: Locale = isLocale(language) ? language : 'zh-CN'
    applyDocumentLanguage(locale)
    rememberLocale(locale)
  })
  instance = i18n
  return i18n
}

/**
 * The locale currently applied, as a supported locale rather than the free-form
 * language string i18next reports.
 *
 * @returns The resolved locale, falling back to `zh-CN` before initialization.
 */
export function activeLocale(): Locale {
  return isLocale(instance?.resolvedLanguage) ? instance.resolvedLanguage : 'zh-CN'
}

/**
 * Switches the interface language. The `languageChanged` handler persists the
 * choice and updates `<html lang>`; react-i18next re-renders every subscribed
 * component.
 *
 * @param locale - Locale to switch to.
 */
export function setLocale(locale: Locale): void {
  void initI18n().changeLanguage(locale)
}
