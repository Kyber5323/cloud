import { describe, expect, it } from 'vitest'
import {
  WORKFLOW_INPUT_FIELD_TYPES,
  resolveWorkflowInputFieldType,
  workflowInputFieldValueType,
} from '@/features/workflows/runtime/start-input'
import {
  WORKFLOW_VARIABLE_VALUE_TYPES,
  type WorkflowInputFieldType,
} from '@/features/workflows/runtime/types'

describe('start input field types', () => {
  it('offers every control exactly once', () => {
    expect(new Set(WORKFLOW_INPUT_FIELD_TYPES).size).toBe(WORKFLOW_INPUT_FIELD_TYPES.length)
    expect(WORKFLOW_INPUT_FIELD_TYPES).toContain<WorkflowInputFieldType>('select')
  })

  it('maps every control to the value type a deployed run collects', () => {
    expect(workflowInputFieldValueType('text-input')).toBe('string')
    expect(workflowInputFieldValueType('paragraph')).toBe('string')
    expect(workflowInputFieldValueType('select')).toBe('string')
    expect(workflowInputFieldValueType('number')).toBe('number')
    expect(workflowInputFieldValueType('checkbox')).toBe('boolean')
    expect(workflowInputFieldValueType('file')).toBe('file')
    expect(workflowInputFieldValueType('file-list')).toBe('array[file]')
    expect(workflowInputFieldValueType('json')).toBe('object')
  })
})

describe('legacy start input resolution', () => {
  it('keeps a control the author already chose', () => {
    expect(resolveWorkflowInputFieldType({ fieldType: 'paragraph', valueType: 'string' })).toBe(
      'paragraph',
    )
  })

  it('derives a control from the declared type for declarations that predate one', () => {
    expect(resolveWorkflowInputFieldType({ valueType: 'integer' })).toBe('number')
    expect(resolveWorkflowInputFieldType({ valueType: 'boolean' })).toBe('checkbox')
    expect(resolveWorkflowInputFieldType({ valueType: 'file' })).toBe('file')
    expect(resolveWorkflowInputFieldType({ valueType: 'array[file]' })).toBe('file-list')
    expect(resolveWorkflowInputFieldType({ valueType: 'secret' })).toBe('text-input')
  })

  it('falls back to the structured control for every remaining type', () => {
    const structured = WORKFLOW_VARIABLE_VALUE_TYPES.filter(
      (valueType) => resolveWorkflowInputFieldType({ valueType }) === 'json',
    )

    expect(structured).toEqual([
      'object',
      'any',
      'array',
      'array[string]',
      'array[number]',
      'array[object]',
      'array[boolean]',
      'array[any]',
    ])
  })
})
