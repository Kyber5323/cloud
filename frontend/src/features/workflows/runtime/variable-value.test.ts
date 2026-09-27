import { describe, expect, it } from 'vitest'
import { WORKFLOW_VARIABLE_VALUE_TYPES } from '@/features/workflows/runtime/types'
import {
  formatWorkflowVariableValue,
  isWorkflowVariableValueType,
  normalizeFileReference,
  normalizeWorkflowVariableValue,
  parseWorkflowVariableValueText,
  workflowVariableValueExample,
  workflowVariableValueMatchesType,
} from '@/features/workflows/runtime/variable-value'

describe('workflow variable text parsing', () => {
  it('treats an empty field as unset for every type rather than as a wrong value', () => {
    for (const valueType of WORKFLOW_VARIABLE_VALUE_TYPES) {
      expect(parseWorkflowVariableValueText('', valueType)).toEqual({
        valid: true,
        value: undefined,
      })
    }
  })

  it('keeps text values as authored', () => {
    expect(parseWorkflowVariableValueText('a b c', 'string')).toEqual({
      valid: true,
      value: 'a b c',
    })
    expect(parseWorkflowVariableValueText('s3cret', 'secret')).toEqual({
      valid: true,
      value: 's3cret',
    })
  })

  it('accepts only the two literal spellings a checkbox produces', () => {
    expect(parseWorkflowVariableValueText('true', 'boolean')).toEqual({ valid: true, value: true })
    expect(parseWorkflowVariableValueText('false', 'boolean')).toEqual({
      valid: true,
      value: false,
    })
    expect(parseWorkflowVariableValueText('TRUE', 'boolean')).toEqual({
      valid: false,
      issue: 'invalid_boolean',
    })
  })

  it('rejects the number spellings Number() would otherwise accept', () => {
    expect(parseWorkflowVariableValueText('1.5', 'number')).toEqual({ valid: true, value: 1.5 })
    expect(parseWorkflowVariableValueText('1e3', 'number')).toEqual({ valid: true, value: 1000 })
    expect(parseWorkflowVariableValueText('0x10', 'number')).toEqual({
      valid: false,
      issue: 'invalid_type',
    })
    expect(parseWorkflowVariableValueText('1_000', 'number')).toEqual({
      valid: false,
      issue: 'invalid_type',
    })
    expect(parseWorkflowVariableValueText('.5', 'number')).toEqual({
      valid: false,
      issue: 'invalid_type',
    })
  })

  it('rejects a fractional value declared as an integer', () => {
    expect(parseWorkflowVariableValueText('1', 'integer')).toEqual({ valid: true, value: 1 })
    expect(parseWorkflowVariableValueText('1.5', 'integer')).toEqual({
      valid: false,
      issue: 'invalid_type',
    })
  })

  it('parses structured text and reports text that is not JSON', () => {
    expect(parseWorkflowVariableValueText('{"a":1}', 'object')).toEqual({
      valid: true,
      value: { a: 1 },
    })
    expect(parseWorkflowVariableValueText('[1,2]', 'array[number]')).toEqual({
      valid: true,
      value: [1, 2],
    })
    expect(parseWorkflowVariableValueText('nope', 'object')).toEqual({
      valid: false,
      issue: 'invalid_json',
    })
  })

  it('keeps untyped text as text when it is not JSON', () => {
    expect(parseWorkflowVariableValueText('nope', 'any')).toEqual({ valid: true, value: 'nope' })
    expect(parseWorkflowVariableValueText('{"a":1}', 'any')).toEqual({
      valid: true,
      value: { a: 1 },
    })
  })
})

describe('workflow variable value normalization', () => {
  it('normalizes a file path into a workspace reference and rejects a bad one', () => {
    expect(normalizeWorkflowVariableValue('docs/one.pdf', 'file')).toEqual({
      valid: true,
      value: { kind: 'workspace_file', path: 'docs/one.pdf' },
    })
    expect(normalizeWorkflowVariableValue('/etc/passwd', 'file')).toEqual({
      valid: false,
      issue: 'invalid_file',
    })
  })

  it('fails a whole file list when one member is not a usable reference', () => {
    expect(normalizeWorkflowVariableValue(['a.pdf', 'b/c.png'], 'array[file]')).toEqual({
      valid: true,
      value: [
        { kind: 'workspace_file', path: 'a.pdf' },
        { kind: 'workspace_file', path: 'b/c.png' },
      ],
    })
    expect(normalizeWorkflowVariableValue(['a.pdf', '../escape'], 'array[file]')).toEqual({
      valid: false,
      issue: 'invalid_file',
    })
    expect(normalizeWorkflowVariableValue('a.pdf', 'array[file]')).toEqual({
      valid: false,
      issue: 'invalid_type',
    })
  })

  it('reports a scalar that does not match its declared type', () => {
    expect(normalizeWorkflowVariableValue('1', 'number')).toEqual({
      valid: false,
      issue: 'invalid_type',
    })
    expect(normalizeWorkflowVariableValue(1, 'number')).toEqual({ valid: true, value: 1 })
  })
})

describe('workflow variable type matching', () => {
  it('accepts any value for the untyped declaration', () => {
    expect(workflowVariableValueMatchesType(undefined, 'any')).toBe(true)
    expect(workflowVariableValueMatchesType({ a: 1 }, 'any')).toBe(true)
  })

  it('matches scalars against their declaration', () => {
    expect(workflowVariableValueMatchesType('x', 'string')).toBe(true)
    expect(workflowVariableValueMatchesType(2, 'integer')).toBe(true)
    expect(workflowVariableValueMatchesType(2.5, 'integer')).toBe(false)
    expect(workflowVariableValueMatchesType(Number.NaN, 'number')).toBe(false)
    expect(workflowVariableValueMatchesType(true, 'boolean')).toBe(true)
    expect(workflowVariableValueMatchesType([], 'object')).toBe(false)
    expect(workflowVariableValueMatchesType({}, 'object')).toBe(true)
  })

  it('matches array members against the item type their declaration names', () => {
    expect(workflowVariableValueMatchesType([1, 'two'], 'array')).toBe(true)
    expect(workflowVariableValueMatchesType([1, 'two'], 'array[any]')).toBe(true)
    expect(workflowVariableValueMatchesType(['one'], 'array[string]')).toBe(true)
    expect(workflowVariableValueMatchesType([1], 'array[string]')).toBe(false)
    expect(workflowVariableValueMatchesType([1.5], 'array[number]')).toBe(true)
    expect(workflowVariableValueMatchesType([Number.NaN], 'array[number]')).toBe(false)
    expect(workflowVariableValueMatchesType([true], 'array[boolean]')).toBe(true)
    expect(workflowVariableValueMatchesType([{}], 'array[object]')).toBe(true)
    expect(workflowVariableValueMatchesType([[]], 'array[object]')).toBe(false)
    expect(workflowVariableValueMatchesType(['a.pdf'], 'array[file]')).toBe(true)
    expect(workflowVariableValueMatchesType(['/a.pdf'], 'array[file]')).toBe(false)
    expect(workflowVariableValueMatchesType('one', 'array[string]')).toBe(false)
  })
})

describe('workflow variable formatting', () => {
  it('renders an unset value as an empty field', () => {
    expect(formatWorkflowVariableValue(undefined, 'string')).toBe('')
  })

  it('renders a file reference as its path', () => {
    expect(formatWorkflowVariableValue({ kind: 'workspace_file', path: 'a.pdf' }, 'file')).toBe(
      'a.pdf',
    )
    expect(formatWorkflowVariableValue({ other: 1 }, 'file')).toBe('{"other":1}')
  })

  it('renders a file list as a JSON array of paths', () => {
    expect(
      formatWorkflowVariableValue(
        [
          { kind: 'workspace_file', path: 'a.pdf' },
          { kind: 'workspace_file', path: 'b.pdf' },
        ],
        'array[file]',
      ),
    ).toBe('["a.pdf","b.pdf"]')
  })

  it('keeps text as text and serializes everything else', () => {
    expect(formatWorkflowVariableValue('plain', 'string')).toBe('plain')
    expect(formatWorkflowVariableValue({ a: 1 }, 'object')).toBe('{"a":1}')
  })
})

describe('workflow variable examples', () => {
  it('offers a placeholder for every declared type that parses back as that type', () => {
    for (const valueType of WORKFLOW_VARIABLE_VALUE_TYPES) {
      const example = workflowVariableValueExample(valueType)
      expect(example).not.toBe('')
      expect(parseWorkflowVariableValueText(example, valueType)).toEqual({
        valid: true,
        value: expect.anything(),
      })
    }
  })
})

describe('workspace file references', () => {
  it('normalizes separators and drops segments that carry no meaning', () => {
    expect(normalizeFileReference('docs\\sub//one.pdf')).toEqual({
      kind: 'workspace_file',
      path: 'docs/sub/one.pdf',
    })
    expect(normalizeFileReference('./docs/./one.pdf')).toEqual({
      kind: 'workspace_file',
      path: 'docs/one.pdf',
    })
  })

  it('accepts the canonical reference shape as well as a bare path', () => {
    expect(normalizeFileReference({ kind: 'workspace_file', path: 'a.pdf' })).toEqual({
      kind: 'workspace_file',
      path: 'a.pdf',
    })
    expect(normalizeFileReference({ kind: 'other', path: 'a.pdf' })).toBeNull()
    expect(normalizeFileReference({ kind: 'workspace_file', path: 1 })).toBeNull()
  })

  it('refuses absolute paths, so a workflow cannot read outside its workspace', () => {
    expect(normalizeFileReference('/etc/passwd')).toBeNull()
    expect(normalizeFileReference('\\windows\\system32')).toBeNull()
    expect(normalizeFileReference('C:/secrets.txt')).toBeNull()
    expect(normalizeFileReference('docs/C:one.pdf')).toBeNull()
  })

  it('refuses parent traversal and empty paths', () => {
    expect(normalizeFileReference('docs/../../etc/passwd')).toBeNull()
    expect(normalizeFileReference('')).toBeNull()
    expect(normalizeFileReference('.')).toBeNull()
    expect(normalizeFileReference(42)).toBeNull()
  })

  it('refuses the Win32 device aliases the backend also rejects', () => {
    expect(normalizeFileReference('docs/CON')).toBeNull()
    expect(normalizeFileReference('docs/con.txt')).toBeNull()
    expect(normalizeFileReference('COM1')).toBeNull()
    expect(normalizeFileReference('lpt9.log')).toBeNull()
    expect(normalizeFileReference('console.txt')).not.toBeNull()
  })
})

describe('workflow variable value types', () => {
  it('recognizes every declared type and nothing else', () => {
    for (const valueType of WORKFLOW_VARIABLE_VALUE_TYPES) {
      expect(isWorkflowVariableValueType(valueType)).toBe(true)
    }
    expect(isWorkflowVariableValueType('text')).toBe(false)
    expect(isWorkflowVariableValueType(7)).toBe(false)
  })
})
