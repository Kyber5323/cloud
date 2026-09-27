import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type {
  WorkflowIterationConfig,
  WorkflowLoopConfig,
  WorkflowNodeData,
} from '@/features/workflows/runtime/types'
import { NodeParameterSummary } from '@/features/workflows/editor/node-parameter-summary'
import { renderWithProviders } from '@/test/render'

/** Builds a card payload for the kind under test. */
function nodeData(patch: Partial<WorkflowNodeData>): WorkflowNodeData {
  return { kind: 'condition', title: '节点', description: '', ...patch }
}

describe('NodeParameterSummary', () => {
  it('summarizes an authored condition case with its localized operator', () => {
    renderWithProviders(
      <NodeParameterSummary
        data={nodeData({
          cases: [
            {
              id: 'case-1',
              logic: 'and',
              conditions: [
                { variableSelector: ['agent-1', 'output'], operator: 'equals', value: 'ok' },
              ],
            },
          ],
        })}
      />,
    )

    expect(screen.getByText('条件')).toBeInTheDocument()
    expect(screen.getByText('agent-1.output 等于 ok')).toBeInTheDocument()
  })

  it('summarizes a tool with its operation and parameter bindings', () => {
    const { container } = renderWithProviders(
      <NodeParameterSummary
        data={nodeData({
          kind: 'tool',
          tool: 'Terminal',
          operation: 'run_command',
          toolParameters: [
            { key: 'repo', value: 'mor' },
            { key: '', value: '' },
          ],
        })}
      />,
    )

    expect(screen.getByText('Terminal')).toBeInTheDocument()
    expect(screen.getByText('执行命令')).toBeInTheDocument()
    expect(screen.getByText('repo = mor')).toBeInTheDocument()
    // The empty parameter row is authored but carries nothing to show.
    expect(container.querySelectorAll('dd')).toHaveLength(3)
  })

  it('summarizes junction strategies in their localized forms', () => {
    renderWithProviders(
      <NodeParameterSummary
        data={nodeData({ kind: 'junction', waitStrategy: 'count', failureStrategy: 'continue' })}
      />,
    )

    expect(screen.getByText('至少 N 个完成')).toBeInTheDocument()
    expect(screen.getByText('收集结果继续')).toBeInTheDocument()
  })

  it('favors count and failure defaults when a junction leaves them unset', () => {
    renderWithProviders(<NodeParameterSummary data={nodeData({ kind: 'junction' })} />)

    expect(screen.getByText('全部分支完成')).toBeInTheDocument()
    expect(screen.getByText('任一失败即失败')).toBeInTheDocument()
  })

  it('summarizes loop limits and the carried initial value', () => {
    const loopConfig: WorkflowLoopConfig = {
      maxIterations: 5,
      variables: [
        {
          name: 'value',
          valueType: 'string',
          initial: { kind: 'constant', value: 'x' },
          feedback: [],
        },
      ],
      until: { logic: 'and', conditions: [] },
      outputs: [],
    }
    renderWithProviders(<NodeParameterSummary data={nodeData({ kind: 'loop', loopConfig })} />)

    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('x')).toBeInTheDocument()
  })

  it('summarizes the iteration selectors and limits', () => {
    const iterationConfig: WorkflowIterationConfig = {
      iteratorSelector: ['iteration-1', 'output'],
      collectSelector: ['agent-2', 'output'],
      errorStrategy: 'continue',
      maxIterations: 50,
    }
    renderWithProviders(
      <NodeParameterSummary data={nodeData({ kind: 'iteration', iterationConfig })} />,
    )

    expect(screen.getByText('iteration-1.output')).toBeInTheDocument()
    expect(screen.getByText('agent-2.output')).toBeInTheDocument()
    expect(screen.getByText('失败轮记入账本并继续')).toBeInTheDocument()
    expect(screen.getAllByText('50')).toHaveLength(1)
  })

  it('adds no section when nothing is configured', () => {
    const { container } = renderWithProviders(<NodeParameterSummary data={nodeData({})} />)

    expect(container.querySelectorAll('dt')).toHaveLength(0)
    expect(screen.queryByText('初始提示词')).not.toBeInTheDocument()
  })
})
