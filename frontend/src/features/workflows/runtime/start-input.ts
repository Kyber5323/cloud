import type {
  WorkflowInputFieldType,
  WorkflowInputVariable,
  WorkflowVariableValueType,
} from '@/features/workflows/runtime/types'

/** Start field types shown by the editor, in the same order as the configuration menu. */
export const WORKFLOW_INPUT_FIELD_TYPES = [
  'text-input',
  'paragraph',
  'select',
  'number',
  'checkbox',
  'file',
  'file-list',
  'json',
] as const satisfies readonly WorkflowInputFieldType[]

/** The variable-pool type each Start form control produces. */
const INPUT_FIELD_VALUE_TYPES: Record<WorkflowInputFieldType, WorkflowVariableValueType> = {
  'text-input': 'string',
  paragraph: 'string',
  select: 'string',
  number: 'number',
  checkbox: 'boolean',
  file: 'file',
  'file-list': 'array[file]',
  json: 'object',
}

/** Returns the variable-pool type produced by one Start form control. */
export function workflowInputFieldValueType(
  fieldType: WorkflowInputFieldType,
): WorkflowVariableValueType {
  return INPUT_FIELD_VALUE_TYPES[fieldType]
}

/** Resolves legacy Start declarations that predate explicit form control metadata. */
export function resolveWorkflowInputFieldType(
  variable: Pick<WorkflowInputVariable, 'fieldType' | 'valueType'>,
): WorkflowInputFieldType {
  if (variable.fieldType !== undefined) {
    return variable.fieldType
  }
  return workflowValueTypeToInputFieldType(variable.valueType)
}

/** Picks the control that best represents one declared variable-pool type. */
function workflowValueTypeToInputFieldType(
  valueType: WorkflowVariableValueType,
): WorkflowInputFieldType {
  switch (valueType) {
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'checkbox'
    case 'file':
      return 'file'
    case 'array[file]':
      return 'file-list'
    case 'string':
    case 'secret':
      return 'text-input'
    default:
      return 'json'
  }
}
