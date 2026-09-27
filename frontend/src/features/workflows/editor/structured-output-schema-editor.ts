import { isJsonRecord as isRecord } from '@/features/workflows/runtime/json-record'
import { isWorkflowVariableValueType } from '@/features/workflows/runtime/variable-value'
import { DEFAULT_WORKFLOW_STRUCTURED_OUTPUT_SCHEMA } from '@/features/workflows/runtime/structured-output-schema'
import type { WorkflowVariableValueType } from '@/features/workflows/runtime/types'

/** A JSON Schema fragment as it is persisted inside an Agent output contract. */
export type StructuredOutputSchemaObject = Record<string, unknown>

/**
 * One editable schema property inside the visual editor.
 *
 * The `id` is a stable session identity handed out once when the draft is
 * created, so a property can be renamed without letting its React key become
 * the array position. `children` holds the nested object (or array-of-object
 * item) properties when `valueType` is an object shape.
 */
export interface StructuredOutputFieldDraft {
  id: number
  name: string
  valueType: WorkflowVariableValueType
  description: string
  required: boolean
  children: StructuredOutputFieldDraft[]
}

/** The visual editor's working copy of one object-rooted schema. */
export interface StructuredOutputSchemaDraft {
  /** The root object's stable identity, so the top level is editable like any branch. */
  rootId: number
  /** The next id an added field will claim, keeping every field unique. */
  nextId: number
  children: StructuredOutputFieldDraft[]
}

/**
 * Builds the editor's working copy for a persisted schema.
 *
 * Only object members survive; every primitive, array and array-item value
 * maps onto a {@link WorkflowVariableValueType}, and an object with no property
 * rows is the same "empty but valid" state the fixed default opens with.
 */
export function createStructuredOutputSchemaDraft(
  schema: StructuredOutputSchemaObject,
): StructuredOutputSchemaDraft {
  let nextId = 0
  const allocate = (): number => nextId++
  const rootId = allocate()
  const children = schemaFieldsToDrafts(schema, allocate)
  return { rootId, nextId, children }
}

/** The empty closed-object schema, freshly allocated so each clear stays reusable. */
export function emptyStructuredOutputSchemaDraft(): StructuredOutputSchemaDraft {
  return createStructuredOutputSchemaDraft(
    structuredClone(DEFAULT_WORKFLOW_STRUCTURED_OUTPUT_SCHEMA),
  )
}

/**
 * Serializes the draft back into the persisted closed-object schema.
 *
 * Blank descriptions are dropped and `required` is filtered to the declared
 * properties, so an accepted draft always survives `validateWorkflowStructuredOutputSchema`.
 */
export function structuredOutputDraftToSchema(
  draft: StructuredOutputSchemaDraft,
): StructuredOutputSchemaObject {
  return buildObjectSchema(draft.children)
}

/**
 * The rows owned by one container: the root object itself, or one field's
 * nested object / array-item object.
 */
export function structuredOutputDraftChildren(
  draft: StructuredOutputSchemaDraft,
  containerId: number,
): StructuredOutputFieldDraft[] {
  if (containerId === draft.rootId) {
    return draft.children
  }
  const container = findDraftField(draft.children, containerId)
  return container === undefined ? [] : container.children
}

/** Replaces the field with `id` anywhere in the tree, keeping every other row. */
export function replaceStructuredOutputField(
  draft: StructuredOutputSchemaDraft,
  id: number,
  next: StructuredOutputFieldDraft,
): StructuredOutputSchemaDraft {
  return { ...draft, children: replaceFieldIn(draft.children, id, next) }
}

/** Removes the field with `id` and any children nested beneath it. */
export function removeStructuredOutputField(
  draft: StructuredOutputSchemaDraft,
  id: number,
): StructuredOutputSchemaDraft {
  return { ...draft, children: removeFieldIn(draft.children, id) }
}

/** Appends a new string property to the container with `containerId`. */
export function addStructuredOutputField(
  draft: StructuredOutputSchemaDraft,
  containerId: number,
): StructuredOutputSchemaDraft {
  const siblings = structuredOutputDraftChildren(draft, containerId)
  const field: StructuredOutputFieldDraft = {
    id: draft.nextId,
    name: nextStructuredOutputFieldName(siblings),
    valueType: 'string',
    description: '',
    required: false,
    children: [],
  }
  const children =
    containerId === draft.rootId
      ? appendFieldIn(draft.children, field)
      : mapFieldContainers(draft.children, containerId, (fields) => appendFieldIn(fields, field))
  return { ...draft, nextId: draft.nextId + 1, children }
}

/**
 * Applies a type change to one field, dropping children a non-object type
 * cannot represent while keeping the author's description.
 */
export function setStructuredOutputFieldType(
  field: StructuredOutputFieldDraft,
  valueType: WorkflowVariableValueType,
): StructuredOutputFieldDraft {
  return {
    ...field,
    valueType,
    children: structuredOutputFieldSupportsChildren(valueType) ? field.children : [],
  }
}

/** True for the object shapes whose own properties stay editable in the editor. */
export function structuredOutputFieldSupportsChildren(
  valueType: WorkflowVariableValueType,
): boolean {
  return valueType === 'object' || valueType === 'array[object]'
}

/**
 * The next unused `field_N` name below the same container, counting up from the
 * row count so a deleted row does not free its name for reuse.
 */
export function nextStructuredOutputFieldName(
  fields: readonly StructuredOutputFieldDraft[],
): string {
  const names = new Set(fields.map((field) => field.name))
  let index = fields.length + 1
  while (names.has(`field_${index}`)) {
    index += 1
  }
  return `field_${index}`
}

/** Converts a persisted JSON Schema field into the editor's value-type list. */
export function structuredOutputSchemaValueType(
  field: StructuredOutputSchemaObject,
): WorkflowVariableValueType {
  if (field['type'] !== 'array') {
    return isWorkflowVariableValueType(field['type']) ? field['type'] : 'any'
  }
  const items = field['items']
  if (!isRecord(items) || !isWorkflowVariableValueType(items['type'])) {
    return 'array'
  }
  const typedArray = `array[${items['type']}]`
  return isWorkflowVariableValueType(typedArray) ? typedArray : 'array'
}

/**
 * The object a field wraps directly (for `object`) or as its array item schema
 * (for `array[object]`); anything else has no editable properties.
 */
export function structuredOutputNestedObjectSchema(
  field: StructuredOutputSchemaObject,
  valueType: WorkflowVariableValueType,
): StructuredOutputSchemaObject | null {
  if (valueType === 'object') {
    return field
  }
  return valueType === 'array[object]' && isRecord(field['items']) ? field['items'] : null
}

/** Reads an object schema's declared properties defensively. */
export function structuredOutputSchemaProperties(
  schema: StructuredOutputSchemaObject,
): Record<string, StructuredOutputSchemaObject> {
  if (!isRecord(schema['properties'])) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(schema['properties']).filter(
      (entry): entry is [string, StructuredOutputSchemaObject] => isRecord(entry[1]),
    ),
  )
}

/** Reads the valid string entries from an object's required list. */
export function structuredOutputSchemaRequiredList(schema: StructuredOutputSchemaObject): string[] {
  const required = schema['required']
  return Array.isArray(required)
    ? required.filter((value): value is string => typeof value === 'string')
    : []
}

/** Accepts only object-rooted schemas, which is what `structured_output` is. */
export function parseWorkflowStructuredOutputSchema(
  text: string,
): StructuredOutputSchemaObject | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) && parsed['type'] === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** Walks one schema's properties, allocating a stable id for each field. */
function schemaFieldsToDrafts(
  schema: StructuredOutputSchemaObject,
  allocate: () => number,
): StructuredOutputFieldDraft[] {
  const properties = structuredOutputSchemaProperties(schema)
  const required = new Set(structuredOutputSchemaRequiredList(schema))
  return Object.entries(properties).map(([name, field]) => {
    const valueType = structuredOutputSchemaValueType(field)
    const nested = structuredOutputNestedObjectSchema(field, valueType)
    return {
      id: allocate(),
      name,
      valueType,
      description: typeof field['description'] === 'string' ? field['description'] : '',
      required: required.has(name),
      children: nested === null ? [] : schemaFieldsToDrafts(nested, allocate),
    }
  })
}

/** Builds a closed object schema from one container's rows. */
function buildObjectSchema(
  children: readonly StructuredOutputFieldDraft[],
): StructuredOutputSchemaObject {
  const properties: Record<string, StructuredOutputSchemaObject> = {}
  const required: string[] = []
  for (const field of children) {
    properties[field.name] = buildFieldSchema(field)
    if (field.required) {
      required.push(field.name)
    }
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

/** Builds one field's JSON Schema fragment, preserving its description. */
function buildFieldSchema(field: StructuredOutputFieldDraft): StructuredOutputSchemaObject {
  const schema: StructuredOutputSchemaObject = buildTypeSchema(field)
  return field.description === '' ? schema : { ...schema, description: field.description }
}

/** The shape a field's value type maps into, before any description. */
function buildTypeSchema(field: StructuredOutputFieldDraft): StructuredOutputSchemaObject {
  if (field.valueType === 'object') {
    return buildObjectSchema(field.children)
  }
  if (field.valueType === 'array[object]') {
    return { type: 'array', items: buildObjectSchema(field.children) }
  }
  if (field.valueType === 'array') {
    return { type: 'array' }
  }
  if (field.valueType.startsWith('array[')) {
    return { type: 'array', items: { type: field.valueType.slice('array['.length, -1) } }
  }
  return { type: field.valueType }
}

/** Locates one field anywhere in the tree, its container included. */
function findDraftField(
  fields: readonly StructuredOutputFieldDraft[],
  id: number,
): StructuredOutputFieldDraft | undefined {
  for (const field of fields) {
    if (field.id === id) {
      return field
    }
    const nested = findDraftField(field.children, id)
    if (nested !== undefined) {
      return nested
    }
  }
  return undefined
}

/** Rebuilds a row list with one field swapped, recursing into nested rows. */
function replaceFieldIn(
  fields: readonly StructuredOutputFieldDraft[],
  id: number,
  next: StructuredOutputFieldDraft,
): StructuredOutputFieldDraft[] {
  return fields.map((field) => {
    if (field.id === id) {
      return next
    }
    return { ...field, children: replaceFieldIn(field.children, id, next) }
  })
}

/** Rebuilds a row list with one field removed, recursing into nested rows. */
function removeFieldIn(
  fields: readonly StructuredOutputFieldDraft[],
  id: number,
): StructuredOutputFieldDraft[] {
  return fields.flatMap((field) => {
    if (field.id === id) {
      return []
    }
    const children = removeFieldIn(field.children, id)
    return children.length === field.children.length ? [field] : [{ ...field, children }]
  })
}

/** Rebuilds a row list carrying one field's row edits down to its container. */
function mapFieldContainers(
  fields: readonly StructuredOutputFieldDraft[],
  containerId: number,
  transform: (children: StructuredOutputFieldDraft[]) => StructuredOutputFieldDraft[],
): StructuredOutputFieldDraft[] {
  return fields.map((field) => {
    if (field.id === containerId) {
      return { ...field, children: transform(field.children) }
    }
    return { ...field, children: mapFieldContainers(field.children, containerId, transform) }
  })
}

/** Appends one row without mutating the list it is given. */
function appendFieldIn(
  fields: readonly StructuredOutputFieldDraft[],
  field: StructuredOutputFieldDraft,
): StructuredOutputFieldDraft[] {
  return [...fields, field]
}
