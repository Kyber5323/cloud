import { isJsonRecord as isRecord } from '@/features/workflows/runtime/json-record'
import { isWorkflowVariableValueType } from '@/features/workflows/runtime/variable-value'

/**
 * Safe closed-object schema an Agent node starts from when structured output is first enabled.
 *
 * `additionalProperties: false` with no declared properties is the only schema that cannot
 * surprise the author: it validates nothing until they add a field themselves.
 */
export const DEFAULT_WORKFLOW_STRUCTURED_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
} as const

/** Outcome of validating one structured-output schema: accepted, or the first offending path. */
export type WorkflowStructuredOutputSchemaValidation =
  { valid: true } | { valid: false; path: string; message: string }

/** The accepted result, shared so the happy path does not allocate per check. */
const ACCEPTED: WorkflowStructuredOutputSchemaValidation = { valid: true }

/**
 * Validates the JSON Schema subset understood by the workflow execution engine.
 *
 * The engine decodes structured output with a hand-written decoder rather than a general JSON
 * Schema implementation, so a schema it cannot honor is rejected here instead of failing a run
 * later. `$` is the root path reported in a rejection.
 */
export function validateWorkflowStructuredOutputSchema(
  schema: unknown,
): WorkflowStructuredOutputSchemaValidation {
  const result = validateSchemaNode(schema, '$')
  if (!result.valid) {
    return result
  }
  return isRecord(schema) && schema['type'] === 'object'
    ? ACCEPTED
    : { valid: false, path: '$', message: 'root type must be object' }
}

/** Recursively verifies one schema fragment and its object or array children. */
function validateSchemaNode(
  schema: unknown,
  path: string,
): WorkflowStructuredOutputSchemaValidation {
  const checks = [
    validateSchemaType(schema, path),
    validateSchemaProperties(schema, path),
    validateSchemaRequired(schema, path),
    validateSchemaAdditionalProperties(schema, path),
  ]
  const failure = checks.find((check) => !check.valid)
  return failure ?? validateSchemaItems(schema, path)
}

/** Requires a declared type the engine knows how to decode. */
function validateSchemaType(
  schema: unknown,
  path: string,
): WorkflowStructuredOutputSchemaValidation {
  if (!isRecord(schema) || typeof schema['type'] !== 'string') {
    return { valid: false, path, message: 'type must be a string' }
  }
  const type = schema['type']
  return type === 'null' || isWorkflowVariableValueType(type)
    ? ACCEPTED
    : { valid: false, path, message: `unsupported type ${type}` }
}

/** Checks the declared properties of an object field, recursing into each one. */
function validateSchemaProperties(
  schema: unknown,
  path: string,
): WorkflowStructuredOutputSchemaValidation {
  if (!isRecord(schema) || schema['properties'] === undefined) {
    return ACCEPTED
  }
  if (schema['type'] !== 'object' || !isRecord(schema['properties'])) {
    return { valid: false, path, message: 'properties is only valid for object fields' }
  }
  for (const [name, property] of Object.entries(schema['properties'])) {
    const result = validateSchemaNode(property, `${path}.properties.${name}`)
    if (!result.valid) {
      return result
    }
  }
  return ACCEPTED
}

/** Requires every `required` entry to name a property the same object declares. */
function validateSchemaRequired(
  schema: unknown,
  path: string,
): WorkflowStructuredOutputSchemaValidation {
  if (!isRecord(schema) || schema['required'] === undefined) {
    return ACCEPTED
  }
  const required = schema['required']
  if (
    schema['type'] !== 'object' ||
    !Array.isArray(required) ||
    !required.every((entry) => typeof entry === 'string')
  ) {
    return { valid: false, path, message: 'required must be a string array on an object field' }
  }
  const properties = isRecord(schema['properties']) ? schema['properties'] : {}
  const undeclared = required.find((name) => !(name in properties))
  return undeclared === undefined
    ? ACCEPTED
    : { valid: false, path, message: `required property ${undeclared} is not declared` }
}

/** Restricts `additionalProperties` to a boolean on object fields. */
function validateSchemaAdditionalProperties(
  schema: unknown,
  path: string,
): WorkflowStructuredOutputSchemaValidation {
  if (!isRecord(schema) || schema['additionalProperties'] === undefined) {
    return ACCEPTED
  }
  return schema['type'] === 'object' && typeof schema['additionalProperties'] === 'boolean'
    ? ACCEPTED
    : { valid: false, path, message: 'additionalProperties must be a boolean on an object field' }
}

/** Restricts `items` to array fields, recursing into the element schema. */
function validateSchemaItems(
  schema: unknown,
  path: string,
): WorkflowStructuredOutputSchemaValidation {
  if (!isRecord(schema) || schema['items'] === undefined) {
    return ACCEPTED
  }
  return schema['type'] === 'array'
    ? validateSchemaNode(schema['items'], `${path}.items`)
    : { valid: false, path, message: 'items is only valid for arrays' }
}
