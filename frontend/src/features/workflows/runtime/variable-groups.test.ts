import { describe, expect, it } from 'vitest'
import { groupWorkflowVariables } from '@/features/workflows/runtime/variable-groups'
import type { WorkflowVariableCatalogEntry } from '@/features/workflows/runtime/variable-catalog'

/** One catalog entry carrying the fields the grouping logic reads. */
function entry(
  selector: string[],
  overrides: Partial<WorkflowVariableCatalogEntry> = {},
): WorkflowVariableCatalogEntry {
  return {
    selector,
    sourceNodeId: selector[0] ?? 'ghost-1',
    variableName: selector.slice(1).join('.'),
    valueType: 'string',
    ...overrides,
  }
}

describe('groupWorkflowVariables', () => {
  it('groups every global under one label, then each source node under its title', () => {
    const groups = groupWorkflowVariables(
      [
        entry(['sys', 'tenant'], { scope: 'global' }),
        entry(['agent-1', 'output'], { sourceNodeTitle: '评审智能体' }),
        entry(['agent-1', 'verdict'], { sourceNodeTitle: '评审智能体' }),
      ],
      '全局变量',
    )
    expect(groups.map((group) => group.label)).toEqual(['全局变量', '评审智能体'])
    expect(groups[0]?.variables.map((variable) => variable.variableName)).toEqual(['tenant'])
    expect(groups[1]?.variables.map((variable) => variable.variableName)).toEqual([
      'output',
      'verdict',
    ])
  })

  it('labels a source its id when no title is known', () => {
    const groups = groupWorkflowVariables([entry(['agent-1', 'output'])], 'Globals')
    expect(groups[0]?.label).toBe('agent-1')
    expect(groups[0]?.variables).toHaveLength(1)
  })

  it('keeps first-appearance order of groups and of variables within a group', () => {
    const groups = groupWorkflowVariables(
      [
        entry(['start-1', 'input'], { sourceNodeTitle: 'Starter' }),
        entry(['agent-1', 'output'], { sourceNodeTitle: 'Agent' }),
        entry(['sys', 'workflow_id'], { scope: 'global' }),
        entry(['start-1', 'repo'], { sourceNodeTitle: 'Starter' }),
      ],
      'Globals',
    )
    // The globals arrive mid-stream here on purpose: the grouping must not assume the catalog
    // already ordered them first, only that first appearance wins.
    expect(groups.map((group) => group.label)).toEqual(['Starter', 'Agent', 'Globals'])
    expect(groups[0]?.variables.map((variable) => variable.variableName)).toEqual(['input', 'repo'])
  })
})
