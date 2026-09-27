import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import type { WorkflowChoice } from '@/features/workflows/runtime/capabilities'
import {
  createDefaultWorkflowCapabilities,
  workflowChoiceLabel,
} from '@/features/workflows/runtime/capabilities'
import { resolveConditionCases } from '@/features/workflows/runtime/condition-cases'
import type {
  WorkflowConditionCase,
  WorkflowConditionComparison,
  WorkflowNodeData,
} from '@/features/workflows/runtime/types'
import { useWorkflowTranslator } from '@/features/workflows/editor/use-workflow-translator'
import type { WorkflowDecoratedVariable } from '@/features/workflows/runtime/variable-catalog'
import {
  LocalizedSelectValue,
  VariableSelectValue,
  WorkflowVariableSelectContent,
  comparisonValueToText,
  parseComparisonValue,
  textToSelector,
} from '@/features/workflows/editor/workflow-variable-select'

/** Props shared by the Condition editor's own components. */
interface WorkflowConditionPanelProps {
  data: WorkflowNodeData
  onChange: (data: WorkflowNodeData) => void
  /** Variables the node may reference, globals first, already decorated. */
  catalog: readonly WorkflowDecoratedVariable[]
}

/** The two ways one case combines its conditions, in menu order. */
const CONDITION_LOGIC_CHOICES: readonly ('and' | 'or')[] = ['and', 'or']

/** Edits the IF/ELIF cases of a Condition node, one card per case. */
export function ConditionNodeFields({ data, onChange, catalog }: WorkflowConditionPanelProps) {
  const translate = useWorkflowTranslator()
  const capabilities = createDefaultWorkflowCapabilities()
  return (
    <ConditionCaseCardList
      cases={resolveConditionCases(data)}
      data={data}
      onChange={onChange}
      operators={capabilities.conditionOperators}
      catalog={catalog}
      translate={translate}
    />
  )
}

/** The case cards and the trailing implicit else block. */
function ConditionCaseCardList({
  cases,
  data,
  onChange,
  operators,
  catalog,
  translate,
}: {
  cases: readonly WorkflowConditionCase[]
  data: WorkflowNodeData
  onChange: (data: WorkflowNodeData) => void
  operators: readonly WorkflowChoice[]
  catalog: readonly WorkflowDecoratedVariable[]
  translate: (key: string) => string
}) {
  const { t } = useTranslation()
  const updateCases = (next: WorkflowConditionCase[]): void => {
    const changed: WorkflowNodeData = { ...data, cases: next }
    // Editing is the migration boundary: keep old saved graphs readable, then persist one shape.
    delete changed.conditionCases
    delete changed.conditionBranches
    onChange(changed)
  }
  const addCase = (): void => {
    updateCases([...cases, defaultConditionCase(nextConditionCaseId(cases))])
  }
  return (
    <>
      {cases.map((conditionCase, caseIndex) => (
        <ConditionCaseCard
          key={conditionCase.id}
          cases={cases}
          caseIndex={caseIndex}
          operators={operators}
          catalog={catalog}
          translate={translate}
          onUpdateCases={updateCases}
        />
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-center bg-muted/70 font-semibold"
        onClick={addCase}
      >
        <Plus />
        {t('workflows.condition.addElif')}
      </Button>
      <ConditionElseDescription />
    </>
  )
}

/** The trailing implicit else branch of a Condition node. */
function ConditionElseDescription() {
  const { t } = useTranslation()
  return (
    <div className="space-y-1 border-t border-border/70 pt-4">
      <span className="text-[11px] font-medium">ELSE</span>
      <p className="text-[11px] leading-5 text-muted-foreground">
        {t('workflows.condition.elseDescription')}
      </p>
    </div>
  )
}

/**
 * One IF or ELIF card: branch label, delete control, and the comparison rows below.
 *
 * The card mutates by finding its own case in the array rather than by positional index
 * arithmetic, so a reordered or edited sibling cannot silently edit the wrong card.
 */
function ConditionCaseCard({
  cases,
  caseIndex,
  operators,
  catalog,
  translate,
  onUpdateCases,
}: {
  cases: readonly WorkflowConditionCase[]
  caseIndex: number
  operators: readonly WorkflowChoice[]
  catalog: readonly WorkflowDecoratedVariable[]
  translate: (key: string) => string
  onUpdateCases: (cases: WorkflowConditionCase[]) => void
}) {
  const { t } = useTranslation()
  const conditionCase = cases[caseIndex]
  if (conditionCase === undefined) {
    return null
  }
  const updateCase = (patch: Partial<WorkflowConditionCase>): void => {
    onUpdateCases(
      cases.map((candidate) =>
        candidate === conditionCase ? { ...candidate, ...patch } : candidate,
      ),
    )
  }
  const addComparison = (): void => {
    onUpdateCases(
      cases.map((candidate) =>
        candidate === conditionCase
          ? {
              ...candidate,
              conditions: [...candidate.conditions, defaultConditionComparison()],
            }
          : candidate,
      ),
    )
  }
  const removeCase = (): void => {
    onUpdateCases(cases.filter((candidate) => candidate !== conditionCase))
  }
  return (
    <section className="space-y-2 border-b border-border/70 pb-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold">{caseIndex === 0 ? 'IF' : 'ELIF'}</span>
        <div className="flex items-center gap-1">
          {conditionCase.conditions.length === 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 bg-background shadow-sm"
              onClick={addComparison}
            >
              <Plus />
              {t('workflows.condition.addRule')}
            </Button>
          )}
          {caseIndex > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label={t('workflows.condition.removeBranch')}
              onClick={removeCase}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      <ConditionComparisonRowsList
        cases={cases}
        conditionCase={conditionCase}
        caseIndex={caseIndex}
        operators={operators}
        catalog={catalog}
        translate={translate}
        onUpdateCase={updateCase}
        onAddComparison={addComparison}
        onUpdateCases={onUpdateCases}
      />
    </section>
  )
}

/** The bordered body holding one case's comparison rows and their AND/OR switch. */
function ConditionComparisonRowsList({
  cases,
  conditionCase,
  caseIndex,
  operators,
  catalog,
  translate,
  onUpdateCase,
  onAddComparison,
  onUpdateCases,
}: {
  cases: readonly WorkflowConditionCase[]
  conditionCase: WorkflowConditionCase
  caseIndex: number
  operators: readonly WorkflowChoice[]
  catalog: readonly WorkflowDecoratedVariable[]
  translate: (key: string) => string
  onUpdateCase: (patch: Partial<WorkflowConditionCase>) => void
  onAddComparison: () => void
  onUpdateCases: (cases: WorkflowConditionCase[]) => void
}) {
  const { t } = useTranslation()
  const updateComparison = (
    comparisonIndex: number,
    patch: Partial<WorkflowConditionComparison>,
  ): void => {
    onUpdateCases(updateConditionComparison(cases, conditionCase, comparisonIndex, patch))
  }
  const removeComparison = (comparisonIndex: number): void => {
    onUpdateCases(removeConditionComparison(cases, conditionCase, comparisonIndex))
  }
  return (
    <div
      className={cn(
        'px-1',
        conditionCase.conditions.length > 1 && 'relative ml-2 border-l border-border/80 pl-3',
      )}
    >
      {conditionCase.conditions.map((comparison, comparisonIndex) => (
        <Fragment key={conditionComparisonKey(comparison)}>
          {comparisonIndex > 0 && (
            <div className="relative h-7">
              <CaseLogicSwitch
                logic={conditionCase.logic ?? 'and'}
                ariaLabel={t('workflows.condition.branchLogic', {
                  index: caseIndex + 1,
                })}
                onLogicChange={(logic) => onUpdateCase({ logic })}
              />
            </div>
          )}
          <ConditionComparisonRow
            comparison={comparison}
            comparisonIndex={comparisonIndex}
            operators={operators}
            catalog={catalog}
            translate={translate}
            onOperatorChange={(operator) => updateComparison(comparisonIndex, { operator })}
            onSelectorChange={(variableSelector) =>
              updateComparison(comparisonIndex, { variableSelector })
            }
            onValueChange={(value) => updateComparison(comparisonIndex, { value })}
            onRemove={() => removeComparison(comparisonIndex)}
          />
        </Fragment>
      ))}
      {conditionCase.conditions.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3 w-fit justify-start border border-border bg-background shadow-sm"
          onClick={onAddComparison}
        >
          <Plus />
          {t('workflows.condition.addRule')}
        </Button>
      )}
    </div>
  )
}

/** The AND/OR selector that sits between a case's comparison rows. */
function CaseLogicSwitch({
  logic,
  ariaLabel,
  onLogicChange,
}: {
  logic: 'and' | 'or'
  ariaLabel: string
  onLogicChange: (logic: 'and' | 'or') => void
}) {
  const { t } = useTranslation()
  return (
    <Select
      value={logic}
      onValueChange={(next) => {
        if (next === 'and' || next === 'or') {
          onLogicChange(next)
        }
      }}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className="absolute -left-6 top-1/2 h-6 w-auto -translate-y-1/2 justify-center gap-1 rounded-md border-blue-200 bg-background px-1.5 text-[10px] font-semibold text-blue-600 shadow-sm dark:border-blue-800 dark:text-blue-400"
      >
        <span>{logic.toUpperCase()}</span>
      </SelectTrigger>
      <SelectContent>
        {CONDITION_LOGIC_CHOICES.map((candidate) => (
          <SelectItem key={candidate} value={candidate}>
            {candidate.toUpperCase()} ·{' '}
            {t(
              candidate === 'and' ? 'workflows.condition.logicAnd' : 'workflows.condition.logicOr',
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** One comparison row of a condition case: a variable, an operator, and a value. */
function ConditionComparisonRow({
  comparison,
  comparisonIndex,
  operators,
  catalog,
  translate,
  onOperatorChange,
  onSelectorChange,
  onValueChange,
  onRemove,
}: {
  comparison: WorkflowConditionComparison
  comparisonIndex: number
  operators: readonly WorkflowChoice[]
  catalog: readonly WorkflowDecoratedVariable[]
  translate: (key: string) => string
  onOperatorChange: (operator: string) => void
  onSelectorChange: (variableSelector: string[]) => void
  onValueChange: (value: unknown) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-start gap-1.5">
      <div className="min-w-0 flex-1 space-y-1.5 rounded-lg bg-muted/70 p-2">
        <Select
          value={comparison.variableSelector.join('.')}
          onValueChange={(value) => {
            if (value !== null) {
              onSelectorChange(textToSelector(value))
            }
          }}
        >
          <SelectTrigger
            className="h-8 w-full bg-background"
            aria-label={t('workflows.condition.field.variable', {
              index: comparisonIndex + 1,
            })}
          >
            <VariableSelectValue
              catalog={catalog}
              selector={comparison.variableSelector}
              placeholder={t('workflows.condition.variablePlaceholder')}
            />
          </SelectTrigger>
          <SelectContent
            alignItemWithTrigger={false}
            align="start"
            className="w-70 min-w-70 max-w-70"
          >
            <WorkflowVariableSelectContent
              variables={catalog}
              globalVariablesLabel={t('workflows.variable.global')}
            />
          </SelectContent>
        </Select>
        <div className="flex min-w-0 gap-1.5">
          <ConditionOperatorSelect
            comparisonIndex={comparisonIndex}
            operators={operators}
            value={comparison.operator}
            translate={translate}
            onOperatorChange={onOperatorChange}
          />
          <Input
            value={comparisonValueToText(comparison.value)}
            aria-label={t('workflows.condition.field.value', {
              index: comparisonIndex + 1,
            })}
            placeholder={t('workflows.condition.valuePlaceholder')}
            className="h-8 min-w-0 flex-1 bg-background"
            onChange={(event) => onValueChange(parseComparisonValue(event.target.value))}
          />
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="mt-1 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        aria-label={t('workflows.condition.removeRule')}
        onClick={onRemove}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}

/** The comparison operator menu of one row. */
function ConditionOperatorSelect({
  comparisonIndex,
  operators,
  value,
  translate,
  onOperatorChange,
}: {
  comparisonIndex: number
  operators: readonly WorkflowChoice[]
  value: string
  translate: (key: string) => string
  onOperatorChange: (operator: string) => void
}) {
  const { t } = useTranslation()
  return (
    <Select
      value={value}
      onValueChange={(operator) => {
        if (operator !== null) {
          onOperatorChange(operator)
        }
      }}
    >
      <SelectTrigger
        aria-label={t('workflows.condition.field.operator', {
          index: comparisonIndex + 1,
        })}
        className="h-8 w-20 shrink-0 bg-background"
      >
        <LocalizedSelectValue
          options={operators}
          value={value}
          placeholder={t('workflows.condition.operatorPlaceholder')}
        />
      </SelectTrigger>
      <SelectContent>
        {operators.map((operator) => (
          <SelectItem key={operator.value} value={operator.value}>
            {workflowChoiceLabel(operator, translate)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A fresh ELIF branch starts empty and exposes an explicit Add condition action. */
function defaultConditionCase(sequence: number): WorkflowConditionCase {
  return { id: `case-${sequence}`, logic: 'and', conditions: [] }
}

/** The next free numeric suffix for a new condition case id. */
function nextConditionCaseId(cases: readonly WorkflowConditionCase[]): number {
  return (
    cases.reduce((max, conditionCase) => {
      const number = /^case-(\d+)$/.exec(conditionCase.id)
      return Math.max(max, number?.[1] === undefined ? 0 : Number(number[1]))
    }, 0) + 1
  )
}

/** A fresh comparison row starts on an empty selector and operator. */
function defaultConditionComparison(): WorkflowConditionComparison {
  return { variableSelector: [], operator: '' }
}

/** Rewrites one comparison of a case into a new full-cases array. */
function updateConditionComparison(
  cases: readonly WorkflowConditionCase[],
  conditionCase: WorkflowConditionCase,
  comparisonIndex: number,
  patch: Partial<WorkflowConditionComparison>,
): WorkflowConditionCase[] {
  const target = conditionCase.conditions[comparisonIndex]
  if (target === undefined) {
    return [...cases]
  }
  return cases.map((candidate) => ({
    ...candidate,
    conditions: candidate.conditions.map((comparison) =>
      comparison === target ? { ...comparison, ...patch } : comparison,
    ),
  }))
}

/** Drops one comparison of a case, returning the untouched array when it is absent. */
function removeConditionComparison(
  cases: readonly WorkflowConditionCase[],
  conditionCase: WorkflowConditionCase,
  comparisonIndex: number,
): WorkflowConditionCase[] {
  const target = conditionCase.conditions[comparisonIndex]
  if (target === undefined) {
    return [...cases]
  }
  return cases.map((candidate) => ({
    ...candidate,
    conditions: candidate.conditions.filter((comparison) => comparison !== target),
  }))
}

/**
 * A stable per-row key for a comparison, built from its content.
 *
 * Comparisons carry no id in the wire format, so the only stable identity is what the row
 * holds. Editing a row changes its key, which is fine — the row being edited is the one that
 * remounts — while rows never reorder, so content keys cannot collide through reshuffling.
 */
function conditionComparisonKey(comparison: WorkflowConditionComparison): string {
  return `${comparison.variableSelector.join('.')}::${comparison.operator}::${comparisonValueToText(comparison.value)}`
}
