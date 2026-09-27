import { useState } from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowInputVariable, WorkflowNodeData } from '@/features/workflows/runtime/types'
import { WorkflowStartVariables } from '@/features/workflows/editor/workflow-start-variables'
import { installCloudSpaceHandlers } from '@/test/cloud-handlers'
import { renderWithProviders } from '@/test/render'

/** A stored Start input variable, as a deployed run would collect it. */
const RECIPIENT: WorkflowInputVariable = {
  name: 'recipient_email',
  valueType: 'string',
  fieldType: 'text-input',
  required: false,
}

/**
 * Wraps the section in the stateful contract the editor provides: every
 * committed change feeds back into the `data` prop, exactly as the node-data
 * channel does, so a saved row appears beneath the section after the dialog
 * closes.
 */
function StartVariablesHarness({
  initial,
  onCommit,
}: {
  initial: WorkflowInputVariable[]
  onCommit: (variables: WorkflowInputVariable[]) => void
}) {
  const [variables, setVariables] = useState(initial)
  const data: WorkflowNodeData = {
    kind: 'start',
    title: '开始',
    description: '',
    inputVariables: variables,
  }
  return (
    <WorkflowStartVariables
      data={data}
      onChange={(next) => {
        onCommit(next.inputVariables ?? [])
        setVariables(next.inputVariables ?? [])
      }}
    />
  )
}

/**
 * Mounts the harness with the given declarations, and hands back the `onCommit`
 * spy covering the whole list each edit committed.
 */
function renderVariables(variables: WorkflowInputVariable[] = []) {
  const onCommit = vi.fn<(variables: WorkflowInputVariable[]) => void>()
  renderWithProviders(<StartVariablesHarness initial={variables} onCommit={onCommit} />)
  return { onCommit }
}

/** The list carried by the last committed change this test's edits pushed. */
function lastVariables(onCommit: ReturnType<typeof renderVariables>['onCommit']): unknown {
  const calls = onCommit.mock.calls
  const last = calls[calls.length - 1]
  if (last === undefined) {
    throw new Error('no change was reported before reading its variables')
  }
  return last[0]
}

/** Adds one option row and types its text through its option input. */
async function typeOption(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: '添加选项' }))
  const rows = within(screen.getByRole('dialog')).queryAllByRole('textbox')
  const row = rows[rows.length - 1]
  if (row === undefined) {
    throw new Error('the select has no rows to type into')
  }
  await user.type(row, text)
}

beforeEach(() => {
  // The section fetches nothing itself, but `renderWithProviders` still resolves
  // the current space, so the signed-in session trios must answer before it.
  installCloudSpaceHandlers('admin')
})

describe('WorkflowStartVariables', () => {
  it('offers the empty call-to-action and walks into the create dialog', () => {
    renderVariables()

    fireEvent.click(screen.getByText('还没有输入变量，点击添加。'))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '新建输入变量' })).toBeInTheDocument()
  })

  it('lists the declared variables with their control and value summaries', () => {
    renderVariables([RECIPIENT])

    expect(screen.getByText('recipient_email')).toBeInTheDocument()
    expect(screen.getByText(/单行文本/)).toBeInTheDocument()
    expect(screen.getByText(/部署时收集/)).toBeInTheDocument()
  })

  it('saves a minimal text variable and closes the dialog', () => {
    const { onCommit } = renderVariables()

    fireEvent.click(screen.getByRole('button', { name: '添加输入变量' }))
    fireEvent.change(screen.getByLabelText('变量名'), { target: { value: 'recipient_email' } })
    fireEvent.change(screen.getByLabelText(/显示名称/), { target: { value: '收件人' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(lastVariables(onCommit)).toEqual([
      {
        name: 'recipient_email',
        displayName: '收件人',
        valueType: 'string',
        fieldType: 'text-input',
        required: false,
      },
    ])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('recipient_email')).toBeInTheDocument()
  })

  it('rejects a blank, dotted or duplicate name', () => {
    renderVariables([RECIPIENT])

    fireEvent.click(screen.getByRole('button', { name: '添加输入变量' }))
    fireEvent.change(screen.getByLabelText('变量名'), { target: { value: 'recipient_email' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(screen.getByText(/非空且不含点号/)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('变量名'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('变量名'), { target: { value: 'scope.name' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(screen.getByText(/非空且不含点号/)).toBeInTheDocument()
  })

  it('edits an existing declaration prefilled from the row', () => {
    const { onCommit } = renderVariables([{ ...RECIPIENT, displayName: '收件人', maxLength: 100 }])

    fireEvent.click(screen.getByLabelText('编辑变量 recipient_email'))
    fireEvent.change(screen.getByLabelText(/显示名称/), { target: { value: '发件人' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(lastVariables(onCommit)).toEqual([
      expect.objectContaining({
        name: 'recipient_email',
        displayName: '发件人',
        maxLength: 100,
      }),
    ])
  })

  it('removes a declaration from the list', () => {
    const { onCommit } = renderVariables([RECIPIENT])

    fireEvent.click(screen.getByLabelText('删除变量 recipient_email'))

    expect(lastVariables(onCommit)).toEqual([])
  })

  it('discards the whole draft when cancelled', () => {
    const { onCommit } = renderVariables()

    fireEvent.click(screen.getByRole('button', { name: '添加输入变量' }))
    fireEvent.change(screen.getByLabelText('变量名'), { target: { value: 'kept?' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(onCommit).not.toHaveBeenCalled()
  })

  it('saves a number declaration with its parsed initial value', async () => {
    const user = userEvent.setup()
    const { onCommit } = renderVariables()

    fireEvent.click(screen.getByRole('button', { name: '添加输入变量' }))
    await user.click(screen.getByRole('combobox', { name: '控件类型' }))
    await user.click(await screen.findByRole('option', { name: /数字/ }))
    fireEvent.change(screen.getByLabelText('变量名'), { target: { value: 'retries' } })
    fireEvent.change(screen.getByLabelText(/初始值/), { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(lastVariables(onCommit)).toEqual([
      {
        name: 'retries',
        valueType: 'number',
        fieldType: 'number',
        required: false,
        value: 123,
      },
    ])
  })

  it('saves a checkbox declaration with its checked initial value', async () => {
    const user = userEvent.setup()
    const { onCommit } = renderVariables()

    fireEvent.click(screen.getByRole('button', { name: '添加输入变量' }))
    await user.click(screen.getByRole('combobox', { name: '控件类型' }))
    await user.click(await screen.findByRole('option', { name: /复选框/ }))
    fireEvent.change(screen.getByLabelText('变量名'), { target: { value: 'notify' } })
    await user.click(screen.getByRole('checkbox', { name: '未选中' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(lastVariables(onCommit)).toEqual([
      {
        name: 'notify',
        valueType: 'boolean',
        fieldType: 'checkbox',
        required: false,
        value: true,
      },
    ])
  })

  it('saves the max length of a text declaration', () => {
    const { onCommit } = renderVariables()

    fireEvent.click(screen.getByRole('button', { name: '添加输入变量' }))
    fireEvent.change(screen.getByLabelText('变量名'), { target: { value: 'summary' } })
    fireEvent.change(screen.getByLabelText(/最大长度/), { target: { value: '140' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(lastVariables(onCommit)).toEqual([
      {
        name: 'summary',
        valueType: 'string',
        fieldType: 'text-input',
        required: false,
        maxLength: 140,
      },
    ])
  })

  it('rejects a non-positive max length', () => {
    renderVariables()

    fireEvent.click(screen.getByRole('button', { name: '添加输入变量' }))
    fireEvent.change(screen.getByLabelText('变量名'), { target: { value: 'summary' } })
    fireEvent.change(screen.getByLabelText(/最大长度/), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(screen.getByText('最大长度必须是正整数。')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('saves a select declaration with its options and picked initial value', async () => {
    const user = userEvent.setup()
    const { onCommit } = renderVariables()

    fireEvent.click(screen.getByRole('button', { name: '添加输入变量' }))
    await user.click(screen.getByRole('combobox', { name: '控件类型' }))
    await user.click(await screen.findByRole('option', { name: /下拉选择/ }))
    fireEvent.change(screen.getByLabelText('变量名'), { target: { value: 'tier' } })
    await typeOption(user, '基础版')
    await typeOption(user, '旗舰版')
    fireEvent.click(screen.getByRole('combobox', { name: /初始值/ }))
    await user.click(await screen.findByRole('option', { name: '基础版' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(lastVariables(onCommit)).toEqual([
      {
        name: 'tier',
        valueType: 'string',
        fieldType: 'select',
        required: false,
        options: ['基础版', '旗舰版'],
        value: '基础版',
      },
    ])
  })

  it('refuses a select whose options are missing or duplicated', async () => {
    const user = userEvent.setup()
    renderVariables()

    fireEvent.click(screen.getByRole('button', { name: '添加输入变量' }))
    await user.click(screen.getByRole('combobox', { name: '控件类型' }))
    await user.click(await screen.findByRole('option', { name: /下拉选择/ }))
    fireEvent.change(screen.getByLabelText('变量名'), { target: { value: 'tier' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(screen.getByText(/需要至少一个选项/)).toBeInTheDocument()

    await typeOption(user, '基础版')
    await typeOption(user, '基础版')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(screen.getByText(/不能重复或为空/)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
