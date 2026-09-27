/**
 * The composition root of the translation resources: the one place that knows
 * which features own messages.
 *
 * Adding a feature's copy means adding its bundle here. Nothing else imports a
 * feature bundle, so a key's owner is unambiguous by construction, and
 * {@link composeTranslationResources} rejects a key two features claim.
 *
 * This module is data only — it never initializes React or i18next, so it stays
 * importable from a test or a script.
 */
import { workflowTranslations } from '@/features/workflows/translations'
import { composeTranslationResources } from '@/i18n/resource-bundle'

/** Every feature's bundle, keyed by the name used in duplicate-key errors. */
export const featureTranslationResources = {
  workflows: workflowTranslations,
} as const

/** The two message maps i18next loads as the `translation` namespace. */
export const translationResources = composeTranslationResources(featureTranslationResources)
