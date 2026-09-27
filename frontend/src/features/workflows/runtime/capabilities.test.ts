import { describe, expect, it } from 'vitest'
import { officialAgentRef } from '@/features/workflows/runtime/agent-identity'
import {
  DEMO_AGENT_MCPS,
  DEMO_AGENT_MODELS,
  DEMO_AGENT_ROLES,
  DEMO_AGENT_SKILLS,
  DEMO_WORKFLOW_TOOLS,
  createDefaultWorkflowCapabilities,
  workflowChoiceLabel,
} from '@/features/workflows/runtime/capabilities'
import { WORKFLOW_CONDITION_OPERATORS } from '@/features/workflows/runtime/condition-cases'

/** Stands in for the active locale's translator, so a key is visible in the assertion. */
const translate = (key: string): string => `<${key}>`

describe('workflow capability choices', () => {
  it('prefers the translation key when a choice has one', () => {
    expect(workflowChoiceLabel({ value: 'Architect', labelKey: 'k' }, translate)).toBe('<k>')
  })

  it('keeps literal menu text for a proper noun', () => {
    expect(workflowChoiceLabel({ value: 'github', label: 'GitHub' }, translate)).toBe('GitHub')
  })

  it('falls back to the value, so a choice can never render as an empty row', () => {
    expect(workflowChoiceLabel({ value: 'github' }, translate)).toBe('github')
  })

  it('names a role by a key, because a role name is a translated concept', () => {
    for (const role of DEMO_AGENT_ROLES) {
      expect(role.labelKey).toBeDefined()
      expect(role.label).toBeUndefined()
    }
  })

  it('names a skill, an MCP, a tool, and a model by their published id', () => {
    expect(DEMO_AGENT_SKILLS.every((skill) => skill.label === skill.value)).toBe(true)
    expect(DEMO_AGENT_MCPS.every((mcp) => (mcp.label ?? '') !== '')).toBe(true)
    expect(DEMO_WORKFLOW_TOOLS.every((tool) => (tool.label ?? '') !== '')).toBe(true)
    expect(DEMO_AGENT_MODELS.every((model) => model.label !== '' && model.modelId !== '')).toBe(
      true,
    )
  })

  it('identifies every agent by its whole namespace-qualified package id', () => {
    for (const model of DEMO_AGENT_MODELS) {
      expect(model.agentCli.startsWith('official/')).toBe(true)
      expect(model.agentCli).toBe(officialAgentRef(model.agentCli.replace('official/', '')))
    }
  })
})

describe('default workflow capabilities', () => {
  it('seeds a new Agent node from the first model in the catalog', () => {
    const capabilities = createDefaultWorkflowCapabilities()
    const first = DEMO_AGENT_MODELS.at(0)

    expect(capabilities.defaultAgentConfig.executor).toEqual({
      agentCli: first?.agentCli,
      modelId: first?.modelId,
    })
    expect(capabilities.defaultAgentConfig.roleId).toBe(DEMO_AGENT_ROLES.at(0)?.value)
    expect(capabilities.defaultAgentConfig).toMatchObject({
      schemaVersion: 3,
      skills: [],
      mcps: [],
      prompt: '',
      interactive: false,
    })
  })

  it('accepts the models the workspace reports instead of the built-in catalog', () => {
    const reported = [{ agentCli: 'official/local', modelId: 'm', label: 'Local · m' }]
    const capabilities = createDefaultWorkflowCapabilities(reported)

    expect(capabilities.agentModels).toBe(reported)
    expect(capabilities.defaultAgentConfig.executor).toEqual({
      agentCli: 'official/local',
      modelId: 'm',
    })
  })

  it('falls back to the built-in model when the workspace reports none', () => {
    const capabilities = createDefaultWorkflowCapabilities([])

    expect(capabilities.defaultAgentConfig.executor).toEqual({
      agentCli: DEMO_AGENT_MODELS.at(0)?.agentCli,
      modelId: DEMO_AGENT_MODELS.at(0)?.modelId,
    })
  })

  it('offers the tool operations of every tool it lists, plus the condition operators', () => {
    const capabilities = createDefaultWorkflowCapabilities()

    for (const tool of capabilities.tools) {
      expect(capabilities.toolOperations[tool.value]?.length).toBeGreaterThan(0)
    }
    expect(capabilities.conditionOperators.map((operator) => operator.value)).toEqual([
      ...WORKFLOW_CONDITION_OPERATORS,
    ])
    expect(capabilities.tools.map((tool) => tool.value)).toContain(capabilities.defaultTool)
  })
})
