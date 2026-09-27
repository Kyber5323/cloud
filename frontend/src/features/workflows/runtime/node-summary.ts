import { workflowChoiceLabel, type WorkflowChoice } from '@/features/workflows/runtime/capabilities'
import { resolveConditionCases } from '@/features/workflows/runtime/condition-cases'
import type {
  WorkflowJunctionFailureStrategy,
  WorkflowJunctionWaitStrategy,
  WorkflowNodeData,
} from '@/features/workflows/runtime/types'

/** Resolves stable label strings for structured node fields on read-only surfaces. */
export interface WorkflowSummaryLabels {
  /** Menu text of one condition comparison operator. */
  operatorLabel: (operator: string) => string
  /** Menu text of one tool operation across every tool catalog. */
  operationLabel: (operation: string) => string
}

/**
 * Builds label resolvers from the capability catalogs of the active locale.
 *
 * A value the catalog does not offer passes through unchanged, so a graph saved against a
 * different catalog never renders a nameless row — the raw id is still readable.
 *
 * @param conditionOperators - Comparison operators offered by Condition nodes.
 * @param toolOperations - Operations offered per tool value.
 * @param translate - Resolves a translation key.
 */
export function createWorkflowSummaryLabels(
  conditionOperators: readonly WorkflowChoice[],
  toolOperations: Readonly<Record<string, readonly WorkflowChoice[]>>,
  translate: (key: string) => string,
): WorkflowSummaryLabels {
  return {
    operatorLabel(operator: string): string {
      const choice = conditionOperators.find((candidate) => candidate.value === operator)
      return choice === undefined ? operator : workflowChoiceLabel(choice, translate)
    },
    operationLabel(operation: string): string {
      for (const catalog of Object.values(toolOperations)) {
        const choice = catalog.find((candidate) => candidate.value === operation)
        if (choice !== undefined) {
          return workflowChoiceLabel(choice, translate)
        }
      }
      return operation
    },
  }
}

/** Localizes a junction wait strategy (`all` | `any` | `count`). */
export function junctionWaitStrategyLabel(
  strategy: WorkflowJunctionWaitStrategy | undefined,
  translate: (key: string) => string,
): string {
  if (strategy === 'any') {
    return translate('workflows.junction.waitAny')
  }
  if (strategy === 'count') {
    return translate('workflows.junction.waitCount')
  }
  return translate('workflows.junction.waitAll')
}

/** Localizes a junction failure strategy (`fail` | `continue`). */
export function junctionFailureStrategyLabel(
  strategy: WorkflowJunctionFailureStrategy | undefined,
  translate: (key: string) => string,
): string {
  return strategy === 'continue'
    ? translate('workflows.junction.collectResults')
    : translate('workflows.junction.failFast')
}

/**
 * Compacts executable condition cases into one readable line, e.g.
 * `分支 1: 工具1.exit_code 等于 0`. Comparisons combine with a locale AND/OR per the case
 * logic. Falls back to the legacy flat condition string so graphs saved before structured
 * cases still summarize correctly.
 *
 * @param data - Node data to read the executable cases from.
 * @param labels - Localized operator and operation label resolvers.
 * @param translate - Resolves a translation key (connectors).
 * @returns The one-line preview, or `null` when the node carries no authored comparison.
 */
export function conditionBranchesSummary(
  data: WorkflowNodeData,
  labels: WorkflowSummaryLabels,
  translate: (key: string) => string,
): string | null {
  const cases = resolveConditionCases(data)
  if (cases.length === 0) {
    return data.condition ?? null
  }
  const lines = cases.map((conditionCase) =>
    conditionCase.conditions
      .map((comparison) =>
        [
          comparison.variableSelector.join('.'),
          labels.operatorLabel(comparison.operator),
          comparisonValueLabel(comparison.value),
        ]
          .filter((part) => part !== '')
          .join(' '),
      )
      .filter((line) => line !== '')
      .join(
        conditionCase.logic === 'or'
          ? translate('workflows.summary.connectorOr')
          : translate('workflows.summary.connectorAnd'),
      ),
  )
  return lines.filter((line) => line !== '').join(translate('workflows.summary.connectorCases'))
}

/** Renders a comparison value as text, JSON for non-strings. */
function comparisonValueLabel(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }
  return typeof value === 'string' ? value : JSON.stringify(value)
}
