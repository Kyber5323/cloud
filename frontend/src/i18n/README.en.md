# i18n: the multilingual infrastructure

[中文](README.md) | [English](README.en.md)

## Responsibility

The i18next instance, locale persistence, and the composition of feature-owned
message bundles into the resource maps. Only the **business-agnostic** machinery
lives here; every individual string belongs to the feature that declares it.

## Contents

| File | Purpose |
| --- | --- |
| `locale.ts` | The locale vocabulary: `Locale` (`zh-CN` \| `en-US`), `LOCALES`, `DEFAULT_LOCALE` (`zh-CN`), the `isLocale` narrowing, `storedLocale` / `rememberLocale` (key `ora.locale`, matching desktop so both products share one language choice), and `applyDocumentLanguage` (writes the locale to `<html lang>` so the browser picks the right font stack and line-breaking rules). Every storage access degrades to the default locale rather than blocking startup. |
| `resource-bundle.ts` | `TranslationBundle` (one feature's messages in both languages) and `composeTranslationResources`, which validates while it composes: both languages must declare the same logical keys (plural keys are expanded through `Intl.PluralRules` first, so a missing English `_one` fails at startup instead of rendering a raw key), and no key may be claimed by two features. The return type is the union of the declared keys, so asking for a key nobody owns is a type error. Pure data: no i18next import, no React import. |
| `resources.ts` | The composition root — the one place that knows which feature owns which messages. Adding a feature is one line here. Exports only `featureTranslationResources` (so error messages can name the owner) and `translationResources` (the two maps i18next loads). |
| `i18n-instance.ts` | The application's single i18next instance. Importing it initializes and binds react-i18next, so any component can call `useTranslation()` with no provider; `main.tsx` imports it once. Exports `TranslationKey` (the union of keys), `activeLocale()` and `setLocale()`. |
| `i18n.test.ts` | Covers the composer's three rejection rules (a locale missing a key, a duplicate key, a missing plural form), the parity of the shipped bundles plus a label and description for every node kind, the locale storage's narrowing and round trip, and that switching language updates both `activeLocale()` and `<html lang>`. |

## Dependency direction

Only third-party libraries, sibling `@/i18n/*` modules, and each feature's
`translations.ts` (from `resources.ts` alone). Importing React components,
`@/api`, or any feature's implementation file is forbidden — `translations.ts`
is pure data and may be depended on; anything else would make the language
infrastructure depend back on business implementations.

## Invariants

- `keySeparator: false` must stay off. Message keys are flat, dot-namespaced
  (`workflows.node.agent.label`); turning the separator on makes i18next read
  one as a nested path and miss it.
- `initAsync: false` must stay. The resources are passed whole to `init()`;
  asynchronous initialization renders the first frame with unresolved keys.
- `resources.ts` is the only place that imports a feature bundle. Importing one
  elsewhere makes "which feature owns this key" statically undecidable and
  defeats the duplicate-key check.
- The node catalog stores **keys** (`workflows.node.<kind>.label`), not resolved
  text: a node's title is resolved once, at creation, and written into the graph
  data. A language switch must relabel the palette without renaming nodes that
  are already on a canvas.
- The resources currently cover the workflow feature only; the rest of the
  interface is still hardcoded Chinese. The instance is application-wide, so
  widening the coverage is a matter of adding bundles to
  `featureTranslationResources` — no call site changes.
