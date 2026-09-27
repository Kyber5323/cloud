import { describe, expect, it } from 'vitest'
import {
  addStructuredOutputField,
  createStructuredOutputSchemaDraft,
  emptyStructuredOutputSchemaDraft,
  nextStructuredOutputFieldName,
  parseWorkflowStructuredOutputSchema,
  removeStructuredOutputField,
  replaceStructuredOutputField,
  setStructuredOutputFieldType,
  structuredOutputDraftChildren,
  structuredOutputDraftToSchema,
  structuredOutputFieldSupportsChildren,
  structuredOutputNestedObjectSchema,
  structuredOutputSchemaProperties,
  structuredOutputSchemaRequiredList,
  structuredOutputSchemaValueType,
  type StructuredOutputFieldDraft,
  type StructuredOutputSchemaObject,
} from '@/features/workflows/editor/structured-output-schema-editor'

/** A representative persisted schema exercising every value shape the editor knows. */
type SampleSchema = StructuredOutputSchemaObject & {
  properties: Record<string, StructuredOutputSchemaObject>
  required: string[]
}

const SAMPLE_SCHEMA: SampleSchema = {
  type: 'object',
  required: ['recipient', 'tier'],
  additionalProperties: false,
  properties: {
    recipient: { type: 'string', description: '收件人邮箱' },
    tier: { type: 'string' },
    retries: { type: 'number' },
    enabled: { type: 'boolean' },
    profile: {
      type: 'object',
      required: ['display_name'],
      additionalProperties: false,
      properties: {
        display_name: { type: 'string' },
        age: { type: 'integer' },
      },
    },
    tags: {
      type: 'array',
      items: {
        type: 'object',
        required: [],
        additionalProperties: false,
        properties: { tag: { type: 'string' } },
      },
    },
    scores: { type: 'array', items: { type: 'number' } },
    plain: { type: 'array' },
  },
}

/** Reads the field carrying a given id from the draft's root rows. */
function draftFieldByName(
  draft: ReturnType<typeof createStructuredOutputSchemaDraft>,
  name: string,
): StructuredOutputFieldDraft {
  const found = structuredOutputDraftChildren(draft, draft.rootId).find(
    (field) => field.name === name,
  )
  if (found === undefined) {
    throw new Error(`no root field named ${name}`)
  }
  return found
}

describe('structured output schema draft', () => {
  it('seeds a draft from every value shape, allocating unique ids across the tree', () => {
    const draft = createStructuredOutputSchemaDraft(SAMPLE_SCHEMA)
    expect(draft.rootId).toBe(0)
    expect(structuredOutputDraftFor(draft).map((field) => field.id)).toHaveLength(8)
    const profile = structuredOutputDraftChildren(draft, 5)
    expect(profile.map((field) => field.name)).toEqual(['display_name', 'age'])
    expect(profile.map((field) => field.id)).toEqual([6, 7])
  })

  it('serializes a seeded draft back to the exact persisted schema', () => {
    expect(structuredOutputDraftToSchema(createStructuredOutputSchemaDraft(SAMPLE_SCHEMA))).toEqual(
      SAMPLE_SCHEMA,
    )
  })

  it('starts every draft from a fresh id pool, so a cleared draft stays reusable', () => {
    const first = emptyStructuredOutputSchemaDraft()
    const second = emptyStructuredOutputSchemaDraft()
    expect(first.nextId).toBe(1)
    expect(second.nextId).toBe(1)
    expect(structuredOutputDraftChildren(second, second.rootId)).toEqual([])
    expect(structuredOutputDraftToSchema(second)).toEqual({
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    })
  })

  it('reads the rows of a nested container by its id, and nothing for unknown ones', () => {
    const draft = createStructuredOutputSchemaDraft(SAMPLE_SCHEMA)
    expect(structuredOutputDraftChildren(draft, draft.rootId)).toHaveLength(8)
    expect(structuredOutputDraftChildren(draft, 5).map((field) => field.name)).toEqual([
      'display_name',
      'age',
    ])
    expect(structuredOutputDraftChildren(draft, 8).map((field) => field.name)).toEqual(['tag'])
    expect(structuredOutputDraftChildren(draft, 99)).toEqual([])
  })

  it('replaces one field anywhere in the tree while keeping its siblings', () => {
    const draft = createStructuredOutputSchemaDraft(SAMPLE_SCHEMA)
    const next = replaceStructuredOutputField(draft, 9, {
      id: 9,
      name: 'label',
      valueType: 'string',
      description: '',
      required: false,
      children: [],
    })
    const tagsField = structuredOutputDraftChildren(next, next.rootId).find(
      (field) => field.name === 'tags',
    )
    expect(tagsField?.children.map((field) => field.name)).toEqual(['label'])
    expect(structuredOutputDraftToSchema(next)).toEqual({
      ...SAMPLE_SCHEMA,
      properties: {
        ...SAMPLE_SCHEMA.properties,
        tags: {
          type: 'array',
          items: {
            type: 'object',
            required: [],
            additionalProperties: false,
            properties: { label: { type: 'string' } },
          },
        },
      },
    })
  })

  it('removes a field and the children nested beneath it', () => {
    const draft = createStructuredOutputSchemaDraft(SAMPLE_SCHEMA)
    const withoutProfile = removeStructuredOutputField(draft, 5)
    expect(
      structuredOutputDraftChildren(withoutProfile, withoutProfile.rootId).map(
        (field) => field.name,
      ),
    ).toEqual(['recipient', 'tier', 'retries', 'enabled', 'tags', 'scores', 'plain'])
    const withoutAge = removeStructuredOutputField(draft, 7)
    expect(structuredOutputDraftChildren(withoutAge, 5).map((field) => field.name)).toEqual([
      'display_name',
    ])
  })

  it('adds a string field at the root with the next sequence name and id', () => {
    const draft = createStructuredOutputSchemaDraft(SAMPLE_SCHEMA)
    const next = addStructuredOutputField(draft, draft.rootId)
    expect(structuredOutputDraftChildren(next, next.rootId).at(-1)).toEqual({
      id: 12,
      name: 'field_9',
      valueType: 'string',
      description: '',
      required: false,
      children: [],
    })
    expect(next.nextId).toBe(13)
  })

  it('adds a field inside a nested container without disturbing the root', () => {
    const draft = createStructuredOutputSchemaDraft(SAMPLE_SCHEMA)
    const next = addStructuredOutputField(draft, 5)
    const profileChildren = structuredOutputDraftChildren(next, 5)
    expect(profileChildren.map((field) => field.name)).toEqual(['display_name', 'age', 'field_3'])
    expect(structuredOutputDraftChildren(draft, draft.rootId)).toHaveLength(8)
  })

  it('skips sequence names that an existing row already claimed', () => {
    const draft = createStructuredOutputSchemaDraftSiblings([
      { name: 'field_3', valueType: 'string' },
      { name: 'field_4', valueType: 'string' },
      { name: 'other', valueType: 'string' },
    ])
    const next = addStructuredOutputField(draft, draft.rootId)
    expect(structuredOutputDraftChildren(next, next.rootId).at(-1)?.name).toBe('field_5')
  })

  it('changes a field type while keeping its description and dropping children an object can hold', () => {
    const draft = createStructuredOutputSchemaDraft(SAMPLE_SCHEMA)
    const profile = draftFieldByName(draft, 'profile')
    const objectToPrimitive = setStructuredOutputFieldType(profile, 'string')
    expect(objectToPrimitive.valueType).toBe('string')
    expect(objectToPrimitive.children).toEqual([])
    const objectToObject = setStructuredOutputFieldType(profile, 'array[object]')
    expect(objectToObject.children).toHaveLength(2)
  })

  it('names only object shapes as nesting containers', () => {
    expect(structuredOutputFieldSupportsChildren('object')).toBe(true)
    expect(structuredOutputFieldSupportsChildren('array[object]')).toBe(true)
    expect(structuredOutputFieldSupportsChildren('string')).toBe(false)
    expect(structuredOutputFieldSupportsChildren('array[number]')).toBe(false)
  })
})

describe('named field sequencing', () => {
  it('counts up from the sibling count, so a deleted name is never reused', () => {
    const names = ['field_1', 'field_2', 'custom']
    expect(nextStructuredOutputFieldName(fieldDrafts(names))).toBe('field_4')
    expect(nextStructuredOutputFieldName(fieldDrafts(['field_4']))).toBe('field_2')
  })
})

describe('persisted schema inspection', () => {
  it('converts JSON Schema array shapes into workflow variable types', () => {
    expect(structuredOutputSchemaValueType({ type: 'string' })).toBe('string')
    expect(structuredOutputSchemaValueType({ type: 'object', properties: {} })).toBe('object')
    expect(structuredOutputSchemaValueType({ type: 'mystery' })).toBe('any')
    expect(structuredOutputSchemaValueType({ type: 'array' })).toBe('array')
    expect(structuredOutputSchemaValueType({ type: 'array', items: { type: 'number' } })).toBe(
      'array[number]',
    )
    expect(structuredOutputSchemaValueType({ type: 'array', items: { type: 'object' } })).toBe(
      'array[object]',
    )
    expect(structuredOutputSchemaValueType({ type: 'array', items: { type: 'mystery' } })).toBe(
      'array',
    )
    expect(structuredOutputSchemaValueType({ type: 'array', items: true })).toBe('array')
  })

  it('finds the editable object of an object or array-of-object field', () => {
    const profile = { type: 'object', properties: { name: { type: 'string' } } }
    const tags = {
      type: 'array',
      items: { type: 'object', properties: { tag: { type: 'string' } } },
    }
    expect(structuredOutputNestedObjectSchema(profile, 'object')).toBe(profile)
    expect(structuredOutputNestedObjectSchema(tags, 'array[object]')).toBe(tags.items)
    expect(structuredOutputNestedObjectSchema(tags, 'array[number]')).toBeNull()
    expect(structuredOutputNestedObjectSchema({ type: 'array' }, 'array[object]')).toBeNull()
  })

  it('reads declared properties and required names defensively', () => {
    expect(structuredOutputSchemaProperties(SAMPLE_SCHEMA)).toHaveProperty('recipient')
    expect(structuredOutputSchemaProperties({})).toEqual({})
    expect(structuredOutputSchemaProperties({ properties: 'nope' })).toEqual({})
    expect(
      structuredOutputSchemaProperties({ properties: { ok: { type: 'string' }, bad: true } }),
    ).toEqual({
      ok: { type: 'string' },
    })
    expect(structuredOutputSchemaRequiredList(SAMPLE_SCHEMA)).toEqual(['recipient', 'tier'])
    expect(structuredOutputSchemaRequiredList({ required: ['a', 7] })).toEqual(['a'])
    expect(structuredOutputSchemaRequiredList({ required: 'a' })).toEqual([])
  })
})

describe('parsing for the JSON editor', () => {
  it('accepts only object-rooted JSON text', () => {
    expect(parseWorkflowStructuredOutputSchema(JSON.stringify(SAMPLE_SCHEMA))).toEqual(
      SAMPLE_SCHEMA,
    )
    expect(parseWorkflowStructuredOutputSchema(JSON.stringify({ type: 'string' }))).toBeNull()
    expect(parseWorkflowStructuredOutputSchema('not json')).toBeNull()
    expect(parseWorkflowStructuredOutputSchema('[1, 2]')).toBeNull()
  })

  it('loads a draft from parsed JSON and round-trips it through the schema', () => {
    const text = `{
      "type": "object",
      "properties": { "name": { "type": "string" }, "box": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } },
      "required": ["name"],
      "additionalProperties": false
    }`
    const parsed = parseWorkflowStructuredOutputSchema(text)
    if (parsed === null) {
      throw new Error('the sample JSON should parse')
    }
    const draft = createStructuredOutputSchemaDraft(parsed)
    expect(structuredOutputDraftToSchema(draft)).toEqual(parsed)
  })
})

/** Builds a draft whose root rows are filled with the given declarations. */
function createStructuredOutputSchemaDraftSiblings(
  siblings: Array<{ name: string; valueType: StructuredOutputFieldDraft['valueType'] }>,
): ReturnType<typeof createStructuredOutputSchemaDraft> {
  let id = 0
  const children: StructuredOutputFieldDraft[] = siblings.map((field) => ({
    id: ++id,
    name: field.name,
    valueType: field.valueType,
    description: '',
    required: false,
    children: [],
  }))
  return { rootId: 0, nextId: id + 1, children }
}

/** Field rows narrowed from a set of names, defaulting to string fields. */
function fieldDrafts(names: string[]): StructuredOutputFieldDraft[] {
  return names.map((name, index) => ({
    id: index,
    name,
    valueType: 'string',
    description: '',
    required: false,
    children: [],
  }))
}

/** The draft's root rows, kept behind a tiny helper so reads stay readable. */
function structuredOutputDraftFor(
  draft: ReturnType<typeof createStructuredOutputSchemaDraft>,
): StructuredOutputFieldDraft[] {
  return structuredOutputDraftChildren(draft, draft.rootId)
}
