import { describe, expect, it } from 'vitest'
import {
  DEMO_CONDITION_OPERATORS,
  DEMO_TOOL_OPERATIONS,
} from '@/features/workflows/runtime/capabilities'
import {
  conditionBranchesSummary,
  createWorkflowSummaryLabels,
  junctionFailureStrategyLabel,
  junctionWaitStrategyLabel,
} from '@/features/workflows/runtime/node-summary'
import type { WorkflowNodeData } from '@/features/workflows/runtime/types'

/** A translation stub that resolves only the keys a test declares. */
function tOf(translations: Record<string, string>): (key: string) => string {
  return (key) => translations[key] ?? key
}

/** Builds a condition node carrying only the fields the summary reads. */
function conditionNode(data: Partial<WorkflowNodeData> = {}): WorkflowNodeData {
  return { kind: 'condition', title: 'Condition 1', description: '', ...data }
}

describe('junction strategy labels', () => {
  const t = tOf({
    'workflows.junction.waitAll': 'ALL',
    'workflows.junction.waitAny': 'ANY',
    'workflows.junction.waitCount': 'COUNT',
    'workflows.junction.failFast': 'FAIL',
    'workflows.junction.collectResults': 'CONTINUE',
  })

  it('defaults an unset wait strategy to all-branches', () => {
    expect(junctionWaitStrategyLabel(undefined, t)).toBe('ALL')
    expect(junctionWaitStrategyLabel('all', t)).toBe('ALL')
    expect(junctionWaitStrategyLabel('any', t)).toBe('ANY')
    expect(junctionWaitStrategyLabel('count', t)).toBe('COUNT')
  })

  it('maps a continue failure strategy to the collect-results label', () => {
    expect(junctionFailureStrategyLabel(undefined, t)).toBe('FAIL')
    expect(junctionFailureStrategyLabel('fail', t)).toBe('FAIL')
    expect(junctionFailureStrategyLabel('continue', t)).toBe('CONTINUE')
  })
})

describe('createWorkflowSummaryLabels', () => {
  const t = tOf({
    'workflows.operator.equals': '等于',
    'workflows.operation.read-file': '读取文件',
  })
  const labels = createWorkflowSummaryLabels(DEMO_CONDITION_OPERATORS, DEMO_TOOL_OPERATIONS, t)

  it('resolves known operators and passes unknown ids through', () => {
    expect(labels.operatorLabel('equals')).toBe('等于')
    expect(labels.operatorLabel('nonsense')).toBe('nonsense')
  })

  it('searches every tool catalog and passes unknown operations through', () => {
    expect(labels.operationLabel('read_file')).toBe('读取文件')
    expect(labels.operationLabel('nonsense')).toBe('nonsense')
  })
})

describe('conditionBranchesSummary', () => {
  const zh = tOf({
    'workflows.operator.equals': '等于',
    'workflows.summary.connectorAnd': '且',
    'workflows.summary.connectorOr': '或',
    'workflows.summary.connectorCases': '；',
  })
  const en = tOf({
    'workflows.operator.equals': 'equals',
    'workflows.summary.connectorAnd': ' and ',
    'workflows.summary.connectorOr': ' or ',
    'workflows.summary.connectorCases': '; ',
  })

  it('joins comparisons and cases with the locale connectors', () => {
    const data = conditionNode({
      cases: [
        {
          id: 'case-1',
          logic: 'and',
          conditions: [
            { variableSelector: ['tool-1', 'exit_code'], operator: 'equals', value: '0' },
          ],
        },
        {
          id: 'case-2',
          logic: 'or',
          conditions: [
            { variableSelector: ['tool-1', 'exit_code'], operator: 'equals', value: '0' },
            { variableSelector: ['agent-1', 'output'], operator: 'equals', value: 'ok' },
          ],
        },
      ],
    })

    const labels = createWorkflowSummaryLabels(DEMO_CONDITION_OPERATORS, DEMO_TOOL_OPERATIONS, zh)
    expect(conditionBranchesSummary(data, labels, zh)).toBe(
      'tool-1.exit_code 等于 0；tool-1.exit_code 等于 0或agent-1.output 等于 ok',
    )
    const englishLabels = createWorkflowSummaryLabels(
      DEMO_CONDITION_OPERATORS,
      DEMO_TOOL_OPERATIONS,
      en,
    )
    expect(conditionBranchesSummary(data, englishLabels, en)).toBe(
      'tool-1.exit_code equals 0; tool-1.exit_code equals 0 or agent-1.output equals ok',
    )
  })

  it('falls back to the legacy flat condition string when no cases exist', () => {
    const labels = createWorkflowSummaryLabels(DEMO_CONDITION_OPERATORS, DEMO_TOOL_OPERATIONS, zh)
    expect(
      conditionBranchesSummary(conditionNode({ cases: [], condition: 'legacy 描述' }), labels, zh),
    ).toBe('legacy 描述')
    expect(conditionBranchesSummary(conditionNode({ cases: [] }), labels, zh)).toBeNull()
  })

  it('reads the stored integer comparison value as text', () => {
    const data = conditionNode({
      cases: [
        {
          id: 'case-1',
          conditions: [{ variableSelector: ['tool-1', 'exit_code'], operator: 'equals', value: 0 }],
        },
      ],
    })
    const labels = createWorkflowSummaryLabels(DEMO_CONDITION_OPERATORS, DEMO_TOOL_OPERATIONS, en)
    expect(conditionBranchesSummary(data, labels, en)).toBe('tool-1.exit_code equals 0')
  })
})
