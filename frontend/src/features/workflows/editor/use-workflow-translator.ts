import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '@/i18n/i18n-instance'
import type { WorkflowNodeTranslator } from '@/features/workflows/runtime/node-factory'

/**
 * Adapts the typed `t()` to the plain key-to-text shape the runtime layer takes.
 *
 * The runtime catalog stores translation keys as ordinary strings, so it cannot
 * name the literal key union `t()` is typed against. The cast is confined to
 * this one function: every other caller keeps the compile-time check that a key
 * exists, and a key the runtime invents at least fails at the lookup rather than
 * at the import.
 *
 * @returns A translator stable across renders, so it can be a dependency.
 */
export function useWorkflowTranslator(): WorkflowNodeTranslator {
  const { t } = useTranslation()
  return useCallback(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the runtime catalog keeps its keys as plain strings, so it cannot name the literal key union `t` is typed against.
    (key: string) => t(key as TranslationKey),
    [t],
  )
}
