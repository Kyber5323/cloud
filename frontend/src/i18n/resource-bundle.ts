/**
 * Composition and validation of the feature-owned translation bundles.
 *
 * Every feature ships its own bundle (a plain object literal, no i18next
 * import), and this module merges them into the two resource maps i18next
 * loads. Composition is where two mistakes become impossible to ship:
 *
 * - a key present in one language but not the other, and
 * - a key owned by two features, so a later `Object.assign` silently wins.
 *
 * Both are checked eagerly at module load, which turns a missing translation
 * into a startup failure with the offending key named, rather than a raw key
 * rendered into the interface.
 */
import { LOCALES, type Locale } from '@/i18n/locale'

/** One feature's messages for every supported locale. */
export type TranslationBundle = Readonly<Record<Locale, Readonly<Record<string, string>>>>

/**
 * Keys of the composed resources, derived from the bundles so a consumer's key
 * type is checked against what the features actually declare.
 */
export type TranslationKeys<Bundle> = Bundle extends TranslationBundle
  ? keyof Bundle['zh-CN']
  : never

/** i18next's plural suffix, e.g. the `_one` in `workflows.items_one`. */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

/**
 * Expands every plural key of `messages` into the forms `locale` requires.
 *
 * Chinese has a single plural category while English has two, so a bundle that
 * declares only `_other` for a count is correct in Chinese and broken in
 * English. Checking the declared suffix against `Intl.PluralRules` catches that
 * before i18next falls back to rendering the key itself.
 *
 * @param messages - One locale's messages, keyed by flat translation key.
 * @param locale - Locale `messages` belongs to.
 * @returns The logical keys (plural suffix stripped), sorted and deduplicated.
 */
function logicalKeys(messages: Readonly<Record<string, string>>, locale: Locale): string[] {
  const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories
  const keys = new Set<string>()
  for (const key of Object.keys(messages)) {
    const suffix = PLURAL_SUFFIX.exec(key)
    if (!suffix) {
      keys.add(key)
      continue
    }
    const logical = key.slice(0, -suffix[0].length)
    for (const category of categories) {
      if (!Object.hasOwn(messages, `${logical}_${category}`)) {
        throw new Error(`Missing ${locale} plural form: ${logical}_${category}`)
      }
    }
    keys.add(logical)
  }
  return [...keys].toSorted()
}

/**
 * Requires both locales of one feature to declare the same logical keys.
 *
 * @param owner - Feature name, used in the error message.
 * @param chinese - Logical keys declared by `zh-CN`.
 * @param english - Logical keys declared by `en-US`.
 */
function assertSameKeys(owner: string, chinese: string[], english: string[]): void {
  const matches = chinese.length === english.length && chinese.every((key, i) => key === english[i])
  if (matches) return
  // Only the locales that are actually short are named, so the message points
  // at the bundle to edit rather than listing an empty list for the other one.
  const gaps = [
    ['zh-CN', english.filter((key) => !chinese.includes(key))],
    ['en-US', chinese.filter((key) => !english.includes(key))],
  ] as const
  const described = gaps
    .filter(([, missing]) => missing.length > 0)
    .map(([locale, missing]) => `${locale} missing [${missing.join(', ')}]`)
    .join('; ')
  throw new Error(`Translation keys differ in ${owner}: ${described}`)
}

/**
 * Records which feature owns each key, rejecting a key claimed twice.
 *
 * @param owners - Owner per key, accumulated across features.
 * @param keys - Keys the current feature declares.
 * @param owner - Feature claiming `keys`.
 */
function claimKeys(owners: Map<string, string>, keys: string[], owner: string): void {
  for (const key of keys) {
    const previous = owners.get(key)
    if (previous !== undefined) {
      throw new Error(`Duplicate translation key ${key}: ${previous} and ${owner}`)
    }
    owners.set(key, owner)
  }
}

/**
 * Merges the feature bundles into the resource maps i18next loads, after
 * proving that the locales agree and that no two features claim one key.
 *
 * The returned object is typed with the union of the declared keys, so a
 * component asking for a key no feature owns fails the type check instead of
 * rendering the key.
 *
 * @param features - Feature name to its bundle, in the order keys are claimed.
 * @returns One message map per locale, ready to pass to i18next as `translation`.
 * @throws When a locale is missing a key another locale declares, when a plural
 *   form required by the locale is absent, or when two features claim one key.
 */
export function composeTranslationResources<
  const Features extends Readonly<Record<string, TranslationBundle>>,
>(features: Features): Record<Locale, Record<TranslationKeys<Features[keyof Features]>, string>> {
  const combined: Record<Locale, Record<string, string>> = { 'zh-CN': {}, 'en-US': {} }
  const owners = new Map<string, string>()
  for (const [owner, bundle] of Object.entries(features)) {
    const chinese = logicalKeys(bundle['zh-CN'], 'zh-CN')
    assertSameKeys(owner, chinese, logicalKeys(bundle['en-US'], 'en-US'))
    claimKeys(owners, chinese, owner)
    for (const locale of LOCALES) Object.assign(combined[locale], bundle[locale])
  }
  // `combined` is built dynamically, so its declared type is the widest map;
  // the return annotation is what narrows it to the union of declared keys,
  // without a second hand-written key catalog that could drift from the bundles.
  return combined
}
