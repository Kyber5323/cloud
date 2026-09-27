import {
  WORKFLOW_VARIABLE_VALUE_TYPES,
  type WorkflowFileReference,
  type WorkflowVariableValueType,
} from '@/features/workflows/runtime/types'
import { isJsonRecord as isRecord } from '@/features/workflows/runtime/json-record'

const VALUE_TYPES: ReadonlySet<string> = new Set<string>(WORKFLOW_VARIABLE_VALUE_TYPES)

/** Narrows an untyped value to one of the value types the variable pool accepts. */
export function isWorkflowVariableValueType(value: unknown): value is WorkflowVariableValueType {
  return typeof value === 'string' && VALUE_TYPES.has(value)
}

/** Why an authored value could not be normalized to its declared type. */
export type WorkflowVariableValueIssue =
  'invalid_boolean' | 'invalid_file' | 'invalid_json' | 'invalid_type'

export type WorkflowVariableValueResult =
  { valid: true; value: unknown } | { valid: false; issue: WorkflowVariableValueIssue }

/**
 * Parses editor text and returns a normalized value only when it matches the declared type.
 *
 * An empty string is a valid "not set" for every type, because clearing a field is not the same
 * as authoring a wrong value.
 */
export function parseWorkflowVariableValueText(
  text: string,
  valueType: WorkflowVariableValueType,
): WorkflowVariableValueResult {
  if (text === '') {
    return { valid: true, value: undefined }
  }
  if (valueType === 'string' || valueType === 'secret') {
    return { valid: true, value: text }
  }
  if (valueType === 'file') {
    return normalizeWorkflowVariableValue(text, valueType)
  }
  if (valueType === 'boolean') {
    return parseBooleanText(text)
  }
  if (valueType === 'number' || valueType === 'integer') {
    return parseNumericText(text, valueType)
  }
  return parseJsonText(text, valueType)
}

/** Parses the two literal spellings a checkbox field can produce. */
function parseBooleanText(text: string): WorkflowVariableValueResult {
  if (text === 'true') {
    return { valid: true, value: true }
  }
  if (text === 'false') {
    return { valid: true, value: false }
  }
  return { valid: false, issue: 'invalid_boolean' }
}

/**
 * Parses a number, rejecting the spellings `Number` would otherwise accept.
 *
 * `Number("")`, `Number("0x10")`, and `Number("1_000")` all produce a value the workflow engine
 * would read differently from what the author typed, so the text is matched against the exact
 * grammar of the declared type instead of being handed to `Number` unchecked.
 */
function parseNumericText(
  text: string,
  valueType: WorkflowVariableValueType,
): WorkflowVariableValueResult {
  const pattern =
    valueType === 'integer' ? /^-?(?:0|[1-9]\d*)$/ : /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/
  const value = Number(text)
  const matches =
    pattern.test(text) &&
    Number.isFinite(value) &&
    (valueType !== 'integer' || Number.isInteger(value))
  return matches ? { valid: true, value } : { valid: false, issue: 'invalid_type' }
}

/** Parses structured text, keeping untyped values as their authored text when they are not JSON. */
function parseJsonText(
  text: string,
  valueType: WorkflowVariableValueType,
): WorkflowVariableValueResult {
  try {
    return normalizeWorkflowVariableValue(JSON.parse(text), valueType)
  } catch {
    return valueType === 'any'
      ? { valid: true, value: text }
      : { valid: false, issue: 'invalid_json' }
  }
}

/** Normalizes file references and verifies every scalar or array item against its declaration. */
export function normalizeWorkflowVariableValue(
  value: unknown,
  valueType: WorkflowVariableValueType,
): WorkflowVariableValueResult {
  if (valueType === 'file') {
    const file = normalizeFileReference(value)
    return file === null ? { valid: false, issue: 'invalid_file' } : { valid: true, value: file }
  }
  if (valueType === 'array[file]') {
    return normalizeFileReferences(value)
  }
  return workflowVariableValueMatchesType(value, valueType)
    ? { valid: true, value }
    : { valid: false, issue: 'invalid_type' }
}

/** Normalizes every member of a file list, failing the whole list on one bad path. */
function normalizeFileReferences(value: unknown): WorkflowVariableValueResult {
  if (!Array.isArray(value)) {
    return { valid: false, issue: 'invalid_type' }
  }
  const files: WorkflowFileReference[] = []
  for (const item of value) {
    const file = normalizeFileReference(item)
    if (file === null) {
      return { valid: false, issue: 'invalid_file' }
    }
    files.push(file)
  }
  return { valid: true, value: files }
}

/** Checks a normalized value against one workflow variable declaration. */
export function workflowVariableValueMatchesType(
  value: unknown,
  valueType: WorkflowVariableValueType,
): boolean {
  if (valueType === 'any') {
    return true
  }
  return valueType.startsWith('array')
    ? arrayValueMatchesType(value, valueType)
    : scalarValueMatchesType(value, valueType)
}

/** Checks one non-array value against its declaration. */
function scalarValueMatchesType(value: unknown, valueType: WorkflowVariableValueType): boolean {
  switch (valueType) {
    case 'string':
    case 'secret':
      return typeof value === 'string'
    case 'file':
      return normalizeFileReference(value) !== null
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'object':
      return isRecord(value)
    default:
      return false
  }
}

/** Checks one array value against the item type its declaration names. */
function arrayValueMatchesType(value: unknown, valueType: WorkflowVariableValueType): boolean {
  if (!Array.isArray(value)) {
    return false
  }
  switch (valueType) {
    case 'array':
    case 'array[any]':
      return true
    case 'array[string]':
      return value.every((item) => typeof item === 'string')
    case 'array[number]':
      return value.every((item) => typeof item === 'number' && Number.isFinite(item))
    case 'array[boolean]':
      return value.every((item) => typeof item === 'boolean')
    case 'array[object]':
      return value.every((item) => isRecord(item))
    case 'array[file]':
      return value.every((item) => normalizeFileReference(item) !== null)
    default:
      return false
  }
}

/** Formats normalized values back into the compact text accepted by the workflow editors. */
export function formatWorkflowVariableValue(
  value: unknown,
  valueType: WorkflowVariableValueType,
): string {
  if (value === undefined) {
    return ''
  }
  if (valueType === 'file' && isRecord(value) && typeof value['path'] === 'string') {
    return value['path']
  }
  if (valueType === 'array[file]' && Array.isArray(value)) {
    return JSON.stringify(value.map(fileReferencePathOrValue))
  }
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** Renders one file-list member as its path, leaving anything unrecognized untouched. */
function fileReferencePathOrValue(item: unknown): unknown {
  return isRecord(item) && typeof item['path'] === 'string' ? item['path'] : item
}

/** One placeholder per declared type, each of which satisfies that type when parsed back. */
const VALUE_EXAMPLES: Record<WorkflowVariableValueType, string> = {
  string: 'text',
  number: '1.5',
  integer: '1',
  boolean: 'true',
  secret: 'token-value',
  file: 'docs/input.pdf',
  object: '{"key":"value"}',
  any: '{"key":"value"}',
  array: '[1,"text",true]',
  'array[any]': '[1,"text",true]',
  'array[string]': '["one","two"]',
  'array[number]': '[1,2.5]',
  'array[object]': '[{"key":"value"}]',
  'array[boolean]': '[true,false]',
  'array[file]': '["docs/one.pdf","images/two.png"]',
}

/** Returns one editor-friendly value that is guaranteed to satisfy the declared type. */
export function workflowVariableValueExample(valueType: WorkflowVariableValueType): string {
  return VALUE_EXAMPLES[valueType]
}

/** Converts a path string or canonical object into a safe Workspace-relative reference. */
export function normalizeFileReference(value: unknown): WorkflowFileReference | null {
  const rawPath = readFilePath(value)
  if (rawPath === null || rawPath === '' || /^[A-Za-z]:/.test(rawPath)) {
    return null
  }
  if (rawPath.startsWith('/') || rawPath.startsWith('\\')) {
    return null
  }
  const segments: string[] = []
  for (const segment of rawPath.split(/[\\/]/)) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..' || /^[A-Za-z]:/.test(segment) || isWindowsReservedName(segment)) {
      return null
    }
    segments.push(segment)
  }
  return segments.length === 0 ? null : { kind: 'workspace_file', path: segments.join('/') }
}

/** Reads the path out of either accepted file-reference spelling. */
function readFilePath(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }
  if (isRecord(value) && value['kind'] === 'workspace_file' && typeof value['path'] === 'string') {
    return value['path']
  }
  return null
}

/** Mirrors the backend's portable-path rejection for Win32 device aliases. */
function isWindowsReservedName(segment: string): boolean {
  const stem = (segment.split('.')[0] ?? '').replace(/[ .]+$/, '').toUpperCase()
  return ['CON', 'PRN', 'AUX', 'NUL'].includes(stem) || /^(COM|LPT)[1-9]$/.test(stem)
}
