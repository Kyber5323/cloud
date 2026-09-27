import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  createDefaultWorkflowCapabilities,
  workflowChoiceLabel,
} from '@/features/workflows/runtime/capabilities'
import type { WorkflowAgentModel } from '@/features/workflows/runtime/capabilities'
import type { WorkflowAgentConfig, WorkflowNodeData } from '@/features/workflows/runtime/types'
import { DEFAULT_WORKFLOW_STRUCTURED_OUTPUT_SCHEMA } from '@/features/workflows/runtime/structured-output-schema'
import { useWorkflowTranslator } from '@/features/workflows/editor/use-workflow-translator'
import { WorkflowStartVariables } from '@/features/workflows/editor/workflow-start-variables'
import { WorkflowStructuredOutputDialog } from '@/features/workflows/editor/workflow-structured-output-dialog'
import { WorkflowStructuredOutputSummary } from '@/features/workflows/editor/workflow-structured-output-summary'
import { WorkflowPromptEditor } from '@/features/workflows/editor/prompt/workflow-prompt-editor'
import type { WorkflowDecoratedVariable } from '@/features/workflows/runtime/variable-catalog'

/** Longest description a card can show before it is clipped. */
const DESCRIPTION_MAX_LENGTH = 30

/** Separates the two halves of an agent-model option value. */
const MODEL_SEPARATOR = '::'

/** Keeps a field label visible and consistently spaced. */
export function InspectorField({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={htmlFor} className="text-[11px]">
        {label}
      </Label>
      {children}
    </div>
  )
}

/** Edits the free-text description shown under a card's title. */
export function NodeDescriptionField({
  data,
  onChange,
}: {
  data: WorkflowNodeData
  onChange: (data: WorkflowNodeData) => void
}) {
  const { t } = useTranslation()
  return (
    <InspectorField
      label={t('workflows.inspector.description')}
      htmlFor="workflow-node-description"
    >
      <Input
        id="workflow-node-description"
        value={data.description}
        maxLength={DESCRIPTION_MAX_LENGTH}
        placeholder={t('workflows.inspector.addDescription')}
        onChange={(event) => onChange({ ...data, description: event.target.value })}
      />
    </InspectorField>
  )
}

/**
 * Edits the Start node's kickoff prompt.
 *
 * A plain textarea rather than the rich prompt editor: variables, mentions and
 * formatting arrive with that editor in a later release, and a textarea stores
 * exactly the same string, so nothing authored here has to be migrated.
 */
export function StartNodeFields({
  data,
  onChange,
}: {
  data: WorkflowNodeData
  onChange: (data: WorkflowNodeData) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <InspectorField
        label={t('workflows.inspector.field.initialPrompt')}
        htmlFor="workflow-start-input"
      >
        <Textarea
          id="workflow-start-input"
          rows={6}
          value={data.input ?? ''}
          onChange={(event) => onChange({ ...data, input: event.target.value })}
        />
        <p className="text-[11px] leading-4 text-muted-foreground">
          {t('workflows.inspector.field.initialPromptHint')}
        </p>
      </InspectorField>
      <WorkflowStartVariables data={data} onChange={onChange} />
    </>
  )
}

/**
 * Edits an Agent node's execution contract.
 *
 * Exposes the executor, the role, the interactive flag, and the optional
 * structured output contract. The prompt, skills and MCP attachments are stored
 * in the same `agentConfig` and are edited by the panels that arrive with them,
 * so a graph saved from this form keeps whatever those fields already held.
 */
export function AgentNodeFields({
  data,
  onChange,
  catalog,
}: {
  data: WorkflowNodeData
  onChange: (data: WorkflowNodeData) => void
  catalog: readonly WorkflowDecoratedVariable[]
}) {
  const { t } = useTranslation()
  const translate = useWorkflowTranslator()
  const config = data.agentConfig
  if (config === undefined) {
    return (
      <p className="text-[11px] text-muted-foreground">{t('workflows.inspector.agentUnset')}</p>
    )
  }
  const { roles, agentModels } = createDefaultWorkflowCapabilities()
  const update = (patch: Partial<typeof config>): void => {
    onChange({ ...data, agentConfig: { ...config, ...patch } })
  }
  return (
    <>
      <InspectorField
        label={t('workflows.inspector.field.agentModel')}
        htmlFor="workflow-agent-model"
      >
        <Select
          value={agentModelKey(config.executor)}
          onValueChange={(value) => {
            const model = agentModels.find((candidate) => agentModelKey(candidate) === value)
            if (model !== undefined) {
              update({ executor: { agentCli: model.agentCli, modelId: model.modelId } })
            }
          }}
        >
          <SelectTrigger id="workflow-agent-model" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {agentModels.map((model) => (
              <SelectItem key={agentModelKey(model)} value={agentModelKey(model)}>
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </InspectorField>
      <InspectorField label={t('workflows.inspector.field.prompt')} htmlFor="workflow-agent-prompt">
        <WorkflowPromptEditor
          value={config.prompt}
          catalog={catalog}
          ariaLabel={t('workflows.inspector.field.prompt')}
          insertVariableLabel={t('workflows.inspector.field.insertVariable')}
          onChange={(prompt) => update({ prompt })}
        />
      </InspectorField>
      <InspectorField label={t('workflows.inspector.field.role')} htmlFor="workflow-agent-role">
        <Select
          value={config.roleId}
          onValueChange={(value) => value !== null && update({ roleId: value })}
        >
          <SelectTrigger id="workflow-agent-role" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roles.map((role) => (
              <SelectItem key={role.value} value={role.value}>
                {workflowChoiceLabel(role, translate)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </InspectorField>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor="workflow-agent-interactive" className="text-[11px]">
            {t('workflows.inspector.field.interactive')}
          </Label>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            {t('workflows.inspector.field.interactiveHint')}
          </p>
        </div>
        <Switch
          id="workflow-agent-interactive"
          checked={config.interactive === true}
          onCheckedChange={(checked) => update({ interactive: checked })}
        />
      </div>
      <AgentStructuredOutputContract
        config={config}
        data={data}
        onChange={onChange}
        update={update}
      />
    </>
  )
}

/**
 * Edits the Agent's optional structured output contract.
 *
 * The switch turns the parsed output on and off, the summary previews the
 * persisted schema, and the dialog edits a fresh copy that only a save commits
 * back through the same node-data channel.
 */
function AgentStructuredOutputContract({
  config,
  data,
  onChange,
  update,
}: {
  config: WorkflowAgentConfig
  data: WorkflowNodeData
  onChange: (data: WorkflowNodeData) => void
  update: (patch: Partial<WorkflowAgentConfig>) => void
}) {
  const { t } = useTranslation()
  const [dialogOpen, setDialogOpen] = useState(false)
  const contract = config.outputContract
  const structuredSchema =
    contract !== undefined && contract.type === 'structured' ? contract.schema : null
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor="workflow-agent-structured-output" className="text-[11px]">
            {t('workflows.inspector.field.structuredOutput')}
          </Label>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            {t('workflows.inspector.field.structuredOutputHint')}
          </p>
        </div>
        <Switch
          id="workflow-agent-structured-output"
          aria-label={t('workflows.inspector.field.structuredOutput')}
          checked={structuredSchema !== null}
          onCheckedChange={setStructuredOutput}
        />
      </div>
      {structuredSchema !== null && (
        <>
          <WorkflowStructuredOutputSummary
            schema={structuredSchema}
            onConfigure={() => setDialogOpen(true)}
          />
          <WorkflowStructuredOutputDialog
            open={dialogOpen}
            schema={structuredSchema}
            onOpenChange={setDialogOpen}
            onSave={(schema) => update({ outputContract: { type: 'structured', schema } })}
          />
        </>
      )}
    </>
  )

  function setStructuredOutput(checked: boolean): void {
    if (checked) {
      update({
        outputContract: {
          type: 'structured',
          schema: structuredClone(DEFAULT_WORKFLOW_STRUCTURED_OUTPUT_SCHEMA),
        },
      })
      return
    }
    // `config` stays shadowed inside this hoisted declaration, so re-read and
    // drop the contract from a narrowed copy before committing.
    const current = data.agentConfig
    if (current === undefined) {
      return
    }
    const next = { ...current }
    delete next.outputContract
    onChange({ ...data, agentConfig: next })
  }
}

/** States that a node kind renders and connects but has no panel yet. */
export function UnconfigurableNotice() {
  const { t } = useTranslation()
  return (
    <p className="text-[11px] leading-4 text-muted-foreground">
      {t('workflows.inspector.notConfigurable')}
    </p>
  )
}

/**
 * Builds the stable option value of one agent model.
 *
 * The label is not usable as a value: it changes with the language, so a
 * selection made in Chinese would not match the same entry in English. The CLI
 * and model id pair is what the graph stores, so it is also what the menu
 * selects on.
 *
 * @param model - Model to encode.
 * @returns The value used both by the option and by the current selection.
 */
function agentModelKey(model: Pick<WorkflowAgentModel, 'agentCli' | 'modelId'>): string {
  return `${model.agentCli}${MODEL_SEPARATOR}${model.modelId}`
}
