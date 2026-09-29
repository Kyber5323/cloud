import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowLaunchField } from '@/features/workflows/runtime/types'
import { WorkflowLaunchFieldsDialog } from '@/features/workflows/editor/workflow-launch-fields-dialog'
import { installCloudSpaceHandlers } from '@/test/cloud-handlers'
import { renderWithProviders } from '@/test/render'

/** Mounts the dialog already open, with the given declaration and Start-node names. */
function renderDialog(
  fields: WorkflowLaunchField[] = [],
  {
    startVariableNames = [],
    hasSnapshots = true,
  }: { startVariableNames?: string[]; hasSnapshots?: boolean | undefined } = {},
) {
  const onSave = vi.fn<(fields: WorkflowLaunchField[]) => void>()
  const onOpenChange = vi.fn<(open: boolean) => void>()
  renderWithProviders(
    <WorkflowLaunchFieldsDialog
      open
      fields={fields}
      startVariableNames={startVariableNames}
      hasSnapshots={hasSnapshots}
      onOpenChange={onOpenChange}
      onSave={onSave}
    />,
  )
  return { onSave, onOpenChange }
}

/** One field's row, found by the title the dialog renders above its hint. */
function fieldRow(field: string): HTMLElement {
  const card = screen.getByText(field).closest('.rounded-lg')
  if (!(card instanceof HTMLElement)) {
    throw new Error(`field ${field} has no row container`)
  }
  return card
}

/** The ask switch of one field's row, which is the row's first. */
function askSwitch(field: string): HTMLElement {
  return switchIn(field, 0)
}

/** The required switch of one field's row, which is the row's second. */
function requiredSwitch(field: string): HTMLElement {
  return switchIn(field, 1)
}

function switchIn(field: string, index: number): HTMLElement {
  const control = within(fieldRow(field)).getAllByRole('switch')[index]
  if (control === undefined) {
    throw new Error(`field ${field} has no switch at ${index}`)
  }
  return control
}

beforeEach(() => {
  // The dialog fetches nothing itself, but `renderWithProviders` still resolves
  // the current space, so the signed-in session trios must answer before it.
  installCloudSpaceHandlers('admin')
})

describe('WorkflowLaunchFieldsDialog', () => {
  it('opens a workflow that declares nothing on the platform defaults', () => {
    renderDialog()

    for (const field of ['仓库地址', '分支', '运行版本', '提示词', '上下文引用']) {
      expect(askSwitch(field)).toBeChecked()
    }
    // Requiredness is the platform's, field by field: the repository and the branch are what a
    // run cannot start without, the rest are choices.
    expect(requiredSwitch('仓库地址')).toBeChecked()
    expect(requiredSwitch('分支')).toBeChecked()
    expect(requiredSwitch('运行版本')).not.toBeChecked()
    expect(requiredSwitch('提示词')).not.toBeChecked()
    expect(requiredSwitch('上下文引用')).not.toBeChecked()
  })

  it('seeds the rows from the declaration the workflow carries', () => {
    renderDialog([
      { key: 'version', enabled: false },
      { key: 'prompt', enabled: true, required: true },
    ])

    expect(askSwitch('运行版本')).not.toBeChecked()
    expect(requiredSwitch('提示词')).toBeChecked()
    // A key the declaration does not name is still asked for at the platform's answer.
    expect(askSwitch('仓库地址')).toBeChecked()
    expect(requiredSwitch('仓库地址')).toBeChecked()
  })

  it('commits every field with both answers spelled out', () => {
    const { onSave, onOpenChange } = renderDialog()

    fireEvent.click(askSwitch('运行版本'))
    fireEvent.click(requiredSwitch('提示词'))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(onSave).toHaveBeenCalledWith([
      { key: 'repository', enabled: true, required: true },
      { key: 'branch', enabled: true, required: true },
      { key: 'version', enabled: false, required: false },
      { key: 'prompt', enabled: true, required: true },
      { key: 'context_refs', enabled: true, required: false },
    ])
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('cannot require a field the form does not ask for', () => {
    const { onSave } = renderDialog()

    fireEvent.click(askSwitch('分支'))
    // The required switch is disabled rather than merely ignored, so the author is told the answer
    // cannot mean anything instead of setting one the projection would drop.
    fireEvent.click(requiredSwitch('分支'))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(onSave).toHaveBeenCalledWith([
      { key: 'repository', enabled: true, required: true },
      { key: 'branch', enabled: false, required: false },
      { key: 'version', enabled: true, required: false },
      { key: 'prompt', enabled: true, required: false },
      { key: 'context_refs', enabled: true, required: false },
    ])
  })

  it('leaves the draft alone when the dialog is cancelled', () => {
    const { onSave, onOpenChange } = renderDialog()

    fireEvent.click(askSwitch('仓库地址'))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows a row the Start node owns as declared rather than editable', () => {
    const { onSave } = renderDialog([], { startVariableNames: ['repository'] })

    expect(screen.getByText('已由开始节点声明，这一行由该变量决定。')).toBeInTheDocument()

    // The author's own variable decides that key, so a declaration about it would be inert: the row
    // says so and refuses the edits, while a key the Start node does not declare still takes one.
    fireEvent.click(askSwitch('仓库地址'))
    fireEvent.click(requiredSwitch('仓库地址'))
    fireEvent.click(askSwitch('分支'))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    // Only the two rows this test is about. The list a save commits is pinned whole by the sibling
    // above; what is at stake here is which of the two keys moved and which one refused to.
    expect(onSave).toHaveBeenCalledWith(
      expect.arrayContaining([
        { key: 'repository', enabled: true, required: true },
        { key: 'branch', enabled: false, required: false },
      ]),
    )
  })

  it('says when the version field has nothing to offer', () => {
    renderDialog([], { hasSnapshots: false })

    expect(screen.getByText('尚无已发布版本，此字段暂不会出现在表单里。')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByText('运行版本')).toBeInTheDocument()
  })

  it('says nothing about versions while that is still unknown', () => {
    // An unresolved read must not claim there are none, and a workflow with published versions
    // has nothing to explain.
    renderDialog([], { hasSnapshots: undefined })
    expect(screen.queryByText('尚无已发布版本，此字段暂不会出现在表单里。')).not.toBeInTheDocument()
  })
})
