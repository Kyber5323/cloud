import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunNodeEntry } from '@/features/workflows/run/run-node-state'
import { RunOverviewCanvas } from '@/features/workflows/run/run-overview-canvas'
import { RUN_SNAPSHOT as SNAPSHOT } from '@/test/run-snapshot'
import { stubViewportGeometry } from '@/test/viewport'
import { renderWithProviders } from '@/test/render'

/** One node's card on the overview canvas. */
function runCard(id: string): HTMLElement {
  const card = document.querySelector(`[data-workflow-run-node][data-workflow-node-id="${id}"]`)
  if (!(card instanceof HTMLElement)) {
    throw new Error(`the run canvas did not draw a card for "${id}"`)
  }
  return card
}

/** The React Flow surface a pane click lands on. */
function pane(): HTMLElement {
  const element = document.querySelector('.react-flow__pane')
  if (!(element instanceof HTMLElement)) {
    throw new Error('the react-flow pane is not rendered')
  }
  return element
}

beforeEach(() => {
  stubViewportGeometry()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RunOverviewCanvas', () => {
  it('paints the run trace status over each node and idle for one it never reached', () => {
    const states: Record<string, RunNodeEntry> = { 'agent-1': { status: 'succeeded' } }
    renderWithProviders(
      <RunOverviewCanvas
        definitionSnapshot={SNAPSHOT}
        nodeStates={states}
        selectedNodeId={null}
        onSelectNode={() => {}}
      />,
    )

    expect(runCard('agent-1')).toHaveAttribute('aria-label', 'Agent 1: 成功')
    expect(runCard('start-1')).toHaveAttribute('aria-label', '开始: 未执行')
  })

  it('raises a selection when a node is clicked and clears on the pane', () => {
    const onSelectNode = vi.fn<(nodeId: string | null) => void>()
    const states: Record<string, RunNodeEntry> = { 'agent-1': { status: 'succeeded' } }
    renderWithProviders(
      <RunOverviewCanvas
        definitionSnapshot={SNAPSHOT}
        nodeStates={states}
        selectedNodeId={null}
        onSelectNode={onSelectNode}
      />,
    )

    fireEvent.click(runCard('agent-1'))
    expect(onSelectNode).toHaveBeenCalledWith('agent-1')

    fireEvent.click(pane())
    expect(onSelectNode).toHaveBeenCalledWith(null)
  })

  it('renders a pending run gracefully with every node idle', () => {
    renderWithProviders(
      <RunOverviewCanvas
        definitionSnapshot={SNAPSHOT}
        nodeStates={{}}
        selectedNodeId={null}
        onSelectNode={() => {}}
      />,
    )

    expect(runCard('start-1')).toHaveAttribute('aria-label', '开始: 未执行')
    expect(runCard('agent-1')).toHaveAttribute('aria-label', 'Agent 1: 未执行')
  })

  it('offers zoom controls and treats an empty snapshot as an empty canvas', () => {
    renderWithProviders(
      <RunOverviewCanvas
        definitionSnapshot={undefined}
        nodeStates={{}}
        selectedNodeId={null}
        onSelectNode={() => {}}
      />,
    )

    expect(screen.getByRole('toolbar', { name: '缩放控件' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '放大' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '缩小' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '适应画布' })).toBeInTheDocument()
  })
})
