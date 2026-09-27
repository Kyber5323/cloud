import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowGlobalVariable } from '@/features/workflows/runtime/types'
import { WorkflowGlobalVariablesDialog } from '@/features/workflows/editor/workflow-global-variables-dialog'
import { installCloudSpaceHandlers } from '@/test/cloud-handlers'
import { renderWithProviders } from '@/test/render'

/** The declaration the runtime itself owns; tests keep it out of the props. */
const SYSTEM_VARIABLES: WorkflowGlobalVariable[] = [
  { name: 'sys.workflow_id', valueType: 'string' },
  { name: 'sys.timestamp', valueType: 'number' },
]

/** What editing a fresh row ends up as, in commit order. */
const COMMITTED_PROJECT: WorkflowGlobalVariable = {
  name: 'global.project',
  valueType: 'string',
  value: '云脑',
}

/**
 * Mounts the dialog already open, feeding the given declarations in.
 *
 * The caller opts into system declarations by including them; the dialog is
 * expected to restore them on save regardless. Returns the two spies the
 * workflow wires up, so each test can assert what the commit carried.
 */
function renderDialog(variables: WorkflowGlobalVariable[]) {
  const onSave = vi.fn<(variables: WorkflowGlobalVariable[]) => void>()
  const onOpenChange = vi.fn<(open: boolean) => void>()
  renderWithProviders(
    <WorkflowGlobalVariablesDialog
      open
      variables={variables}
      onOpenChange={onOpenChange}
      onSave={onSave}
    />,
  )
  return { onSave, onOpenChange }
}

/** The one-line validation message beneath a row with a bad value. */
function invalidHint(index: number): HTMLElement {
  const row = customRow(index)
  const hint = within(row).queryByText(/值与 .* 类型不匹配/)
  if (hint === null) {
    throw new Error(`row ${index} shows no invalid-value hint`)
  }
  return hint
}

/** The custom-section container a row lives in, found by its remove control. */
function customRow(index: number): HTMLElement {
  const remove = screen.getByLabelText(`移除全局变量 ${index}`)
  if (!(remove.parentElement instanceof HTMLElement)) {
    throw new Error(`row ${index} has no container element`)
  }
  return remove.parentElement.parentElement ?? remove.parentElement
}

/**
 * Fills a freshly-added row and saves it.
 *
 * The added row is always row 2 (row 1 is the first seeded custom row, when
 * the fixture keeps one), so the name and value labels follow its index.
 */
function addProjectRowAndSave(): void {
  fireEvent.click(screen.getByRole('button', { name: '添加全局变量' }))
  fireEvent.change(screen.getByLabelText('全局变量 2 名称'), {
    target: { value: 'global.project' },
  })
  fireEvent.change(screen.getByLabelText('全局变量 2 值'), {
    target: { value: '云脑' },
  })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
}

beforeEach(() => {
  // The dialog fetches nothing itself, but `renderWithProviders` still resolves
  // the current space, so the signed-in session trios must answer before it.
  installCloudSpaceHandlers('admin')
})

describe('WorkflowGlobalVariablesDialog', () => {
  it('shows the runtime-provided declarations read-only', () => {
    renderDialog([...SYSTEM_VARIABLES])

    for (const variable of SYSTEM_VARIABLES) {
      const card = variable.name === 'sys.workflow_id' ? '当前工作流 ID' : '应用开始运行时的时间戳'
      expect(screen.getByText(variable.name)).toBeInTheDocument()
      expect(screen.getByText(card)).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /移除全局变量/ })).not.toBeInTheDocument()
  })

  it('seeds the authored custom rows as editable fields', () => {
    renderDialog([...SYSTEM_VARIABLES, { name: 'config.mode', valueType: 'string', value: 'auto' }])

    expect(screen.getByLabelText('全局变量 1 名称')).toHaveValue('config.mode')
    expect(screen.getByLabelText('全局变量 1 值')).toHaveValue('auto')
    expect(screen.getByRole('combobox', { name: '全局变量 1 类型' })).toBeInTheDocument()
  })

  it('commits the added declaration, restores the system globals and closes', () => {
    const { onSave, onOpenChange } = renderDialog([...SYSTEM_VARIABLES])

    addProjectRowAndSave()

    expect(onSave).toHaveBeenCalledWith([COMMITTED_PROJECT, ...SYSTEM_VARIABLES])
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('discards the edit when cancelled, without touching the draft', () => {
    const { onSave, onOpenChange } = renderDialog([
      ...SYSTEM_VARIABLES,
      { name: 'config.mode', valueType: 'string', value: 'auto' },
    ])

    fireEvent.change(screen.getByLabelText('全局变量 1 名称'), {
      target: { value: 'config.silenced' },
    })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('removes a custom row from the pending list', () => {
    renderDialog([...SYSTEM_VARIABLES, { name: 'config.mode', valueType: 'string', value: 'auto' }])

    fireEvent.click(screen.getByLabelText('移除全局变量 1'))

    expect(screen.queryByLabelText('全局变量 1 名称')).not.toBeInTheDocument()
  })

  it('blocks saving on a value the declared type cannot hold', () => {
    renderDialog([{ name: 'retries.max', valueType: 'number', value: 'abc' }, ...SYSTEM_VARIABLES])

    expect(invalidHint(1)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('swapping the value type drops the value it can no longer represent', async () => {
    const user = userEvent.setup()
    renderDialog([...SYSTEM_VARIABLES, { name: 'config.mode', valueType: 'string', value: 'auto' }])

    await user.click(screen.getByRole('combobox', { name: '全局变量 1 类型' }))
    await user.click(await screen.findByRole('option', { name: 'number' }))

    expect(screen.getByLabelText('全局变量 1 值')).toHaveValue('')
  })

  it('keeps the system globals even when the props omit them', () => {
    const { onSave } = renderDialog([COMMITTED_PROJECT])

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(onSave).toHaveBeenCalledWith([
      COMMITTED_PROJECT,
      { name: 'sys.workflow_id', valueType: 'string' },
      { name: 'sys.timestamp', valueType: 'number' },
    ])
  })
})
