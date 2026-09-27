import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowDecoratedVariable } from '@/features/workflows/runtime/variable-catalog'
import type { WorkflowVariableValueType } from '@/features/workflows/runtime/types'
import { WorkflowPromptEditor } from '@/features/workflows/editor/prompt/workflow-prompt-editor'
import { renderWithProviders } from '@/test/render'

/** One catalog entry the insert menu offers, keyed by its dotted selector. */
function catalogVariable(
  selector: string,
  variableName: string,
  valueType: WorkflowVariableValueType = 'string',
): WorkflowDecoratedVariable {
  return {
    selector: selector.split('.'),
    sourceNodeId: selector.split('.')[0] ?? '',
    variableName,
    valueType,
    scope: 'node',
    sourceNodeTitle: `节点 ${selector}`,
    sourceNodeKind: 'agent',
  }
}

const CATALOG = [catalogVariable('agent-1.output', 'output')]

/** Mounts the editor with a recorded commit callback. */
function renderEditor(value: string, catalog: readonly WorkflowDecoratedVariable[] = CATALOG) {
  const onChange = vi.fn<(value: string) => void>()
  renderWithProviders(
    <WorkflowPromptEditor
      value={value}
      catalog={catalog}
      ariaLabel="自定义 Prompt"
      insertVariableLabel="插入变量"
      onChange={onChange}
    />,
  )
  return { onChange }
}

/** The editor's contenteditable DOM node, where text edits reach ProseMirror. */
function editorInput(): HTMLElement {
  const editor = document.getElementById('workflow-agent-prompt')
  if (!(editor instanceof HTMLElement)) {
    throw new Error('prompt editor not mounted')
  }
  return editor
}

/**
 * Waits for the React-driven token chip to mount inside the contenteditable.
 *
 * Tiptap renders atom node views through a nested React root, so their DOM
 * appears a microtask after the document settles; a bare querySelector races it.
 */
async function flushNodeViews() {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('WorkflowPromptEditor', () => {
  let writeTextSpy: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>

  beforeEach(() => {
    // jsdom has no clipboard; stub writeText so the copy tool is observable.
    writeTextSpy = vi.fn<(text: string) => Promise<void>>()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextSpy },
    })
  })

  it('seeds the editor from the stored prompt string', () => {
    renderEditor('你好 **世界**')
    const editor = editorInput()
    expect(editor).not.toBeNull()
    expect(editor.textContent).toContain('你好')
  })

  it('renders a catalog variable as a Dify-style chip', async () => {
    renderEditor('值：{{#agent-1.output#}}')
    await flushNodeViews()
    const chip = document.querySelector('[data-workflow-prompt-variable=""]')
    expect(chip).not.toBeNull()
    expect(chip?.textContent).toContain('output')
  })

  it('renders an unknown token as its raw selector text', async () => {
    renderEditor('未知 {{#else.where#}}')
    await flushNodeViews()
    expect(document.querySelector('[data-prompt-token="variable"]')?.textContent).toContain(
      'else.where',
    )
  })

  it('shows the live character count in the tool row', () => {
    renderEditor('一 二 三')
    expect(screen.getByLabelText('5 字符')).toBeTruthy()
  })

  it('opens the variable menu when the author types a slash', async () => {
    const user = userEvent.setup()
    renderEditor('')
    await user.click(editorInput())
    await user.keyboard('使用 /agen')
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByText('output')).toBeTruthy()
  })

  it('inserts a chosen variable as a token and commits the serialized text', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor('')
    await user.click(editorInput())
    await user.keyboard('使用 /agen')
    const listbox = await screen.findByRole('listbox')
    await user.click(within(listbox).getByText('output'))
    expect(document.querySelector('[data-workflow-prompt-variable=""]')).not.toBeNull()
    expect(onChange).toHaveBeenCalledWith('使用 {{#agent-1.output#}} ')
  })

  it('disables the variable button when the catalog is empty', () => {
    renderEditor('无变量', [])
    expect(screen.getByLabelText('插入变量')).toBeDisabled()
  })

  it('copies the current plain text to the clipboard', () => {
    renderEditor('复制 **这段**')
    fireEvent.click(screen.getByLabelText('复制 Prompt'))
    expect(writeTextSpy).toHaveBeenCalledWith('复制 **这段**')
  })

  it('expands into a dialog that reseeds from the committed value', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor('抽屉里')
    await user.click(screen.getByLabelText('展开编辑器'))
    expect(screen.getByText('抽屉里')).toBeTruthy()
    // Rewrite the dialog's whole content, as the desktop suite does with its
    // own prompt editor: prove the fresh surface is editable and that edits
    // commit back through the same callback, matching the reseeded value.
    await user.clear(editorInput())
    await user.type(editorInput(), '全新')
    expect(onChange).toHaveBeenLastCalledWith('全新')
  })
})
