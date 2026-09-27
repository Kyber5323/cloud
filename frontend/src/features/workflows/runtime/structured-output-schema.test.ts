import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKFLOW_STRUCTURED_OUTPUT_SCHEMA,
  validateWorkflowStructuredOutputSchema,
} from '@/features/workflows/runtime/structured-output-schema'

describe('structured output schema validation', () => {
  it('accepts the schema a node starts from', () => {
    expect(
      validateWorkflowStructuredOutputSchema(DEFAULT_WORKFLOW_STRUCTURED_OUTPUT_SCHEMA),
    ).toEqual({ valid: true })
  })

  it('requires the root to be an object, because only objects have named fields', () => {
    expect(validateWorkflowStructuredOutputSchema({ type: 'string' })).toEqual({
      valid: false,
      path: '$',
      message: 'root type must be object',
    })
    expect(validateWorkflowStructuredOutputSchema(undefined)).toEqual({
      valid: false,
      path: '$',
      message: 'type must be a string',
    })
  })

  it('rejects a type the engine cannot decode', () => {
    expect(
      validateWorkflowStructuredOutputSchema({
        type: 'object',
        properties: { when: { type: 'date-time' } },
      }),
    ).toEqual({ valid: false, path: '$.properties.when', message: 'unsupported type date-time' })
  })

  it('reports the path of the first offending nested property', () => {
    expect(
      validateWorkflowStructuredOutputSchema({
        type: 'object',
        properties: {
          summary: { type: 'string' },
          items: { type: 'array', items: { type: 'object', properties: { n: { type: 1 } } } },
        },
      }),
    ).toEqual({
      valid: false,
      path: '$.properties.items.items.properties.n',
      message: 'type must be a string',
    })
  })

  it('allows a nullable field, which the engine decodes as an absent value', () => {
    expect(
      validateWorkflowStructuredOutputSchema({
        type: 'object',
        properties: { note: { type: 'null' } },
      }),
    ).toEqual({ valid: true })
  })

  it('restricts properties, required, additionalProperties, and items to their own types', () => {
    expect(validateWorkflowStructuredOutputSchema({ type: 'array', properties: {} })).toEqual({
      valid: false,
      path: '$',
      message: 'properties is only valid for object fields',
    })
    expect(
      validateWorkflowStructuredOutputSchema({ type: 'object', properties: [], required: [] }),
    ).toEqual({
      valid: false,
      path: '$',
      message: 'properties is only valid for object fields',
    })
    expect(validateWorkflowStructuredOutputSchema({ type: 'array', required: ['a'] })).toEqual({
      valid: false,
      path: '$',
      message: 'required must be a string array on an object field',
    })
    expect(validateWorkflowStructuredOutputSchema({ type: 'object', required: [1] })).toEqual({
      valid: false,
      path: '$',
      message: 'required must be a string array on an object field',
    })
    expect(
      validateWorkflowStructuredOutputSchema({ type: 'object', additionalProperties: 'no' }),
    ).toEqual({
      valid: false,
      path: '$',
      message: 'additionalProperties must be a boolean on an object field',
    })
    expect(
      validateWorkflowStructuredOutputSchema({ type: 'string', items: { type: 'string' } }),
    ).toEqual({ valid: false, path: '$', message: 'items is only valid for arrays' })
  })

  it('refuses to require a property the object never declares', () => {
    expect(
      validateWorkflowStructuredOutputSchema({
        type: 'object',
        properties: {},
        required: ['missing'],
      }),
    ).toEqual({
      valid: false,
      path: '$',
      message: 'required property missing is not declared',
    })
    expect(
      validateWorkflowStructuredOutputSchema({
        type: 'object',
        properties: { present: { type: 'string' } },
        required: ['present'],
      }),
    ).toEqual({ valid: true })
  })

  it('accepts a required list on an object that declares no properties at all', () => {
    expect(validateWorkflowStructuredOutputSchema({ type: 'object', required: [] })).toEqual({
      valid: true,
    })
  })
})
