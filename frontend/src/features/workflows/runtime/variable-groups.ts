import type { WorkflowVariableCatalogEntry } from '@/features/workflows/runtime/variable-catalog'

/** One group in the unified variable list: a heading plus its variables. */
export interface WorkflowVariableMenuGroup<
  Variable extends WorkflowVariableCatalogEntry = WorkflowVariableCatalogEntry,
> {
  label: string
  variables: Variable[]
}

/**
 * Groups globals first, then each producing node, preserving catalog order within a group.
 *
 * The grouping is what makes a flat selector list readable: a graph with six upstream nodes would
 * otherwise present one undifferentiated run of rows, and the author has no way to tell which
 * `output` belongs to which step.
 *
 * @param variables - Catalog entries, in the order they should appear.
 * @param globalVariablesLabel - Heading for the workflow-wide declarations.
 * @returns One group per source, in first-appearance order.
 */
export function groupWorkflowVariables<Variable extends WorkflowVariableCatalogEntry>(
  variables: readonly Variable[],
  globalVariablesLabel: string,
): WorkflowVariableMenuGroup<Variable>[] {
  const groups = new Map<string, WorkflowVariableMenuGroup<Variable>>()
  for (const variable of variables) {
    const label =
      variable.scope === 'global'
        ? globalVariablesLabel
        : (variable.sourceNodeTitle ?? variable.sourceNodeId)
    const group = groups.get(label)
    if (group === undefined) {
      groups.set(label, { label, variables: [variable] })
    } else {
      group.variables.push(variable)
    }
  }
  return [...groups.values()]
}
