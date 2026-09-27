import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isJsonRecord } from '@/features/workflows/runtime/json-record'
import type { StructuredOutputSchemaObject } from '@/features/workflows/editor/structured-output-schema-editor'
import { WorkflowStructuredOutputDialog } from '@/features/workflows/editor/workflow-structured-output-dialog'
import { installCloudSpaceHandlers } from '@/test/cloud-handlers'
import { renderWithProviders } from '@/test/render'

/** Keeps `properties` and `required` reachable without index-signature syntax. */
type ScopeSchema = StructuredOutputSchemaObject & {
  properties: Record<string, StructuredOutputSchemaObject>
  required: string[]
}

/** A persisted contract mixing required, described and nested fields. */
const SCHEMA: ScopeSchema = {
  type: 'object',
  required: ['recipient'],
  additionalProperties: false,
  properties: {
    recipient: { type: 'string', description: '收件人' },
    profile: {
      type: 'object',
      required: [],
      additionalProperties: false,
      properties: { age: { type: 'number' } },
    },
  },
}

/** The closed-object schema a save commits when nothing is declared. */
const EMPTY_SCHEMA: StructuredOutputSchemaObject = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
}

/**
 * Mounts the dialog in its open state, feeding the given schema in.
 *
 * The dialog owns its own draft so every edit is provisional; only committing
 * (保存) reports anything back. Returns the two spies the editor wires up.
 */
function renderDialog(schema: StructuredOutputSchemaObject = SCHEMA) {
  const onSave = vi.fn<(schema: StructuredOutputSchemaObject) => void>()
  const onOpenChange = vi.fn<(open: boolean) => void>()
  renderWithProviders(
    <WorkflowStructuredOutputDialog
      open
      schema={schema}
      onOpenChange={onOpenChange}
      onSave={onSave}
    />,
  )
  return { onSave, onOpenChange }
}

/** The row card for one field, found through its edit control. */
function fieldRow(name: string): HTMLElement {
  const edit = screen.getByLabelText(`编辑字段 ${name}`)
  const card = edit.closest('.rounded-lg')
  if (!(card instanceof HTMLElement)) {
    throw new Error(`field ${name} has no row container`)
  }
  return card
}

/** One 添加字段 action; `index` selects among the visible containers. */
function addFieldAt(index: number): void {
  const button = screen.getAllByRole('button', { name: /^添加字段$/ })[index]
  if (button === undefined) {
    throw new Error(`no 添加字段 button at index ${index}`)
  }
  fireEvent.click(button)
}

/** The last schema value save carried, so tests compare a committed shape. */
function lastSaved(onSave: ReturnType<typeof renderDialog>['onSave']): unknown {
  const calls = onSave.mock.calls
  const last = calls[calls.length - 1]
  if (last === undefined) {
    throw new Error('save reported no schema before it was read back')
  }
  return last[0]
}

/**
 * The last committed schema, narrowed down to the keys tests read.
 *
 * `lastSaved` returns an opaque value, so reaching `properties` or `required`
 * has to go through a real guard rather than a cast.
 */
function lastSavedSchema(onSave: ReturnType<typeof renderDialog>['onSave']): {
  properties: Record<string, unknown>
  required: string[]
} {
  const value = lastSaved(onSave)
  const properties = isJsonRecord(value) ? value['properties'] : undefined
  const required = isJsonRecord(value) ? value['required'] : undefined
  return {
    properties: isJsonRecord(properties) ? properties : {},
    required: Array.isArray(required)
      ? required.filter((entry): entry is string => typeof entry === 'string')
      : [],
  }
}

beforeEach(() => {
  // The dialog fetches nothing itself, but `renderWithProviders` still resolves
  // the current space, so the signed-in session trios must answer before it.
  installCloudSpaceHandlers('admin')
})

describe('WorkflowStructuredOutputDialog', () => {
  it('renders the persisted fields with their types and nested objects', () => {
    renderDialog()

    expect(screen.getByText('recipient')).toBeInTheDocument()
    expect(screen.getByText('收件人')).toBeInTheDocument()
    expect(screen.getByText('profile')).toBeInTheDocument()
    expect(screen.getByText('age')).toBeInTheDocument()
    expect(screen.getAllByText('object')).toHaveLength(2)
  })

  it('adds a root field and commits it only on save', () => {
    const { onSave } = renderDialog()

    addFieldAt(0)

    expect(screen.getByText('field_3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(lastSaved(onSave)).toEqual({
      ...SCHEMA,
      properties: { ...SCHEMA.properties, field_3: { type: 'string' } },
    })
  })

  it('adds a field inside a nested object, leaving the root untouched', () => {
    const { onSave } = renderDialog()

    addFieldAt(1)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(screen.getByText('field_2')).toBeInTheDocument()
    expect(lastSavedSchema(onSave)['properties']['profile']).toEqual({
      type: 'object',
      required: [],
      additionalProperties: false,
      properties: { age: { type: 'number' }, field_2: { type: 'string' } },
    })
  })

  it('renames a field through its edit state', () => {
    const { onSave } = renderDialog()

    fireEvent.click(screen.getByLabelText('编辑字段 recipient'))
    fireEvent.change(screen.getByLabelText('字段名'), { target: { value: 'email' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    const schema = lastSavedSchema(onSave)
    expect(Object.keys(schema.properties)).toEqual(['email', 'profile'])
    expect(schema.required).toEqual(['email'])
  })

  it('changes a field type and keeps its human description', async () => {
    const user = userEvent.setup()
    const { onSave } = renderDialog()

    fireEvent.click(screen.getByLabelText('编辑字段 recipient'))
    await user.click(screen.getByRole('combobox', { name: '字段类型' }))
    await user.click(await screen.findByRole('option', { name: 'array[number]' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    const schema = lastSavedSchema(onSave)
    expect(schema['properties']['profile']).toBeDefined()
    expect(schema['properties']['recipient']).toEqual({
      type: 'array',
      items: { type: 'number' },
      description: '收件人',
    })
  })

  it('marks a field required through its row switch', async () => {
    const user = userEvent.setup()
    const { onSave } = renderDialog()

    await user.click(within(fieldRow('profile')).getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(lastSavedSchema(onSave).required).toEqual(['recipient', 'profile'])
  })

  it('removes a field along with its required membership', () => {
    const { onSave } = renderDialog()

    fireEvent.click(screen.getByLabelText('删除字段 recipient'))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    const schema = lastSavedSchema(onSave)
    expect(schema.properties).not.toHaveProperty('recipient')
    expect(schema.required).toEqual([])
  })

  it('mirrors visual edits into the JSON editor', () => {
    renderDialog()

    addFieldAt(0)
    fireEvent.click(screen.getByRole('tab', { name: /JSON/ }))

    const json = screen.getByLabelText('JSON Schema 文本')
    if (!(json instanceof HTMLTextAreaElement)) {
      throw new Error('the JSON editor is not a textarea')
    }
    expect(json.value).toContain('field_3')
    expect(json.value).toContain('"description": "收件人"')
  })

  it('refuses invalid JSON when leaving the JSON editor', async () => {
    const user = userEvent.setup()
    renderDialog()

    fireEvent.click(screen.getByRole('tab', { name: /JSON/ }))
    const json = screen.getByLabelText('JSON Schema 文本')
    await user.clear(json)
    // `{` is a userEvent keyboard-descriptor delimiter, so type plain invalid text.
    await user.type(json, 'not json')

    fireEvent.click(screen.getByRole('tab', { name: /可视化/ }))

    expect(screen.getByRole('alert')).toHaveTextContent(/JSON Schema 无效/)
    expect(screen.getByRole('tab', { name: /JSON/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('saves the edited JSON as the committed schema', () => {
    const { onSave } = renderDialog()
    const next: StructuredOutputSchemaObject = {
      type: 'object',
      required: [],
      additionalProperties: false,
      properties: { note: { type: 'string' } },
    }

    fireEvent.click(screen.getByRole('tab', { name: /JSON/ }))
    fireEvent.change(screen.getByLabelText('JSON Schema 文本'), {
      target: { value: JSON.stringify(next) },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(onSave).toHaveBeenCalledWith(next)
  })

  it('clear discards every field back to the empty closed schema', () => {
    const { onSave } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(screen.queryByText('recipient')).not.toBeInTheDocument()
    expect(lastSaved(onSave)).toEqual(EMPTY_SCHEMA)
  })

  it('cancelling closes without committing a draft', () => {
    const { onSave, onOpenChange } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSave).not.toHaveBeenCalled()
  })
})
