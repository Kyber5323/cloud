import { useState, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  WORKFLOW_INPUT_FIELD_TYPES,
  resolveWorkflowInputFieldType,
  workflowInputFieldValueType,
} from '@/features/workflows/runtime/start-input'
import type {
  WorkflowInputFieldType,
  WorkflowInputVariable,
  WorkflowVariableValueType,
} from '@/features/workflows/runtime/types'
import {
  formatWorkflowVariableValue,
  parseWorkflowVariableValueText,
  workflowVariableValueExample,
} from '@/features/workflows/runtime/variable-value'
import type { WorkflowVariableValueResult } from '@/features/workflows/runtime/variable-value'
import { StartFieldTypeIcon } from '@/features/workflows/editor/workflow-start-field-type-icon'

/** The focused create/edit session, with the list index it came from. */
export interface StartVariableDialogState {
  /** Position in the Start's variable list, or `null` for a brand-new row. */
  index: number | null
  /** The variable this session starts from, to prefill every field. */
  variable: WorkflowInputVariable
}

/** One option being edited, carrying a stable session id for a React key. */
interface StartVariableOption {
  id: number
  text: string
}

/** The editable fields of one variable, separated from its derived validity. */
interface StartVariableDraft {
  name: string
  displayName: string
  fieldType: WorkflowInputFieldType
  required: boolean
  optionDrafts: StartVariableOption[]
  maxLengthText: string
  valueText: string
}

/** Everything a save block or a section needs to know about the current draft. */
interface StartVariableValidation {
  trimmedName: string
  nameInvalid: boolean
  parsedValue: WorkflowVariableValueResult
  selectOptions: string[]
  optionsInvalid: boolean
  maxLength: number
  maxLengthInvalid: boolean
  valueExceedsMaxLength: boolean
  selectedValueInvalid: boolean
  canSave: boolean
}

/**
 * Creates or edits one Start input variable.
 *
 * Cancelling never touches the graph: the draft lives in component state and is
 * only committed — as `WorkflowInputVariable` — when 保存 is pressed. The
 * graph-wide save is a single history step because the parent replaces the
 * whole `inputVariables` list through the node-data channel.
 *
 * @param props.state - The session: which row, seeded from which variable.
 * @param props.existingNames - Names of the Start's other variables to reject collisions.
 * @param props.onCancel - Discards the draft and closes.
 * @param props.onSave - Commits one variable to the list.
 */
export function WorkflowStartVariableDialog({
  state,
  existingNames,
  onCancel,
  onSave,
}: {
  state: StartVariableDialogState
  existingNames: string[]
  onCancel: () => void
  onSave: (variable: WorkflowInputVariable) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<StartVariableDraft>(() =>
    seedStartVariableDraft(state.variable),
  )
  const [attemptedSave, setAttemptedSave] = useState(false)
  const validation = validateStartVariableDraft(draft, existingNames)

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {state.index === null
              ? t('workflows.start.createVariableTitle')
              : t('workflows.start.editVariableTitle')}
          </DialogTitle>
        </DialogHeader>
        <StartVariableFields
          draft={draft}
          validation={validation}
          attemptedSave={attemptedSave}
          setDraft={setDraft}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('workflows.list.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => {
              setAttemptedSave(true)
              if (!validation.canSave) {
                return
              }
              onSave(commitStartVariable(draft, validation))
            }}
          >
            {t('workflows.globalVariables.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Every editable field of the variable, below the title.
 *
 * Kept a sibling of the dialog so the footer stays compact and the save gate
 * lives in one place; the draft and its validity are shared, so editing an
 * invalid field shows its error through the shared `attemptedSave` flag.
 */
function StartVariableFields({
  draft,
  validation,
  attemptedSave,
  setDraft,
}: {
  draft: StartVariableDraft
  validation: StartVariableValidation
  attemptedSave: boolean
  setDraft: Dispatch<SetStateAction<StartVariableDraft>>
}) {
  const { t } = useTranslation()
  const valueType = workflowInputFieldValueType(draft.fieldType)
  const displayMaxLength =
    validation.maxLengthInvalid || validation.valueExceedsMaxLength ? validation.maxLength : null
  return (
    <div className="space-y-5 py-2">
      <StartVariableTypeField
        fieldType={draft.fieldType}
        onChange={(next) => changeFieldType(setDraft, next)}
      />
      <StartVariableTextControl
        label={t('workflows.start.variableName')}
        htmlFor="workflow-start-variable-name"
        value={draft.name}
        invalid={attemptedSave && validation.nameInvalid}
        hint={t('workflows.start.variableNameInvalid')}
        placeholder={t('workflows.start.variableNamePlaceholder')}
        onChange={(value) => setDraft((current) => ({ ...current, name: value }))}
      />
      <StartVariableTextControl
        label={t('workflows.start.displayName')}
        optional
        htmlFor="workflow-start-variable-display-name"
        value={draft.displayName}
        invalid={false}
        hint=""
        placeholder={t('workflows.start.displayNamePlaceholder')}
        onChange={(value) => setDraft((current) => ({ ...current, displayName: value }))}
      />
      {supportsMaxLength(draft.fieldType) && (
        <StartVariableTextControl
          label={t('workflows.start.maxLength')}
          optional
          htmlFor="workflow-start-variable-max-length"
          type="number"
          value={draft.maxLengthText}
          invalid={attemptedSave && validation.maxLengthInvalid}
          hint={t('workflows.start.maxLengthInvalid')}
          placeholder={t('workflows.start.maxLengthPlaceholder')}
          onChange={(value) => setDraft((current) => ({ ...current, maxLengthText: value }))}
        />
      )}
      {draft.fieldType === 'select' && (
        <StartVariableSelectOptions
          options={draft.optionDrafts}
          invalid={attemptedSave && validation.optionsInvalid}
          hint={t('workflows.start.optionsInvalid')}
          onChangeText={(optionId, text) =>
            setDraft((current) => updateOptionText(current, optionId, text))
          }
          onRemove={(optionId) =>
            setDraft((current) => ({ ...current, optionDrafts: removeOption(current, optionId) }))
          }
          onAdd={() =>
            setDraft((current) => ({ ...current, optionDrafts: addOption(current.optionDrafts) }))
          }
        />
      )}
      <StartVariableValueControl
        fieldType={draft.fieldType}
        valueType={valueType}
        valueText={draft.valueText}
        selectOptions={validation.selectOptions}
        parsedValue={validation.parsedValue}
        exceedsMaxLength={validation.valueExceedsMaxLength}
        maxLength={displayMaxLength}
        selectedValueInvalid={validation.selectedValueInvalid}
        showErrors={attemptedSave}
        onValueTextChange={(value) => setDraft((current) => ({ ...current, valueText: value }))}
      />
      <label className="flex items-center gap-2 text-sm font-medium">
        <Checkbox
          checked={draft.required}
          onCheckedChange={(checked) => setDraft((current) => ({ ...current, required: checked }))}
        />
        {t('workflows.start.required')}
      </label>
    </div>
  )
}

/** The form control selector, which changes the value and options fields below it. */
function StartVariableTypeField({
  fieldType,
  onChange,
}: {
  fieldType: WorkflowInputFieldType
  onChange: (next: WorkflowInputFieldType) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1.5">
      <Label htmlFor="workflow-start-variable-type" className="text-[11px]">
        {t('workflows.start.fieldType')}
      </Label>
      <Select
        value={fieldType}
        onValueChange={(candidate) => {
          if (isWorkflowInputFieldType(candidate)) {
            onChange(candidate)
          }
        }}
      >
        <SelectTrigger id="workflow-start-variable-type" className="w-full bg-muted/45">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WORKFLOW_INPUT_FIELD_TYPES.map((candidate) => (
            <SelectItem key={candidate} value={candidate}>
              <span className="flex w-full items-center justify-between gap-4">
                <span className="flex items-center gap-2">
                  <StartFieldTypeIcon
                    fieldType={candidate}
                    className="size-4 text-muted-foreground"
                  />
                  {t(`workflows.start.fieldTypes.${candidate}`)}
                </span>
                <code className="text-[10px] text-muted-foreground">
                  {workflowInputFieldValueType(candidate)}
                </code>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** One labelled text/number input with an optional invalid-state message. */
function StartVariableTextControl({
  label,
  optional,
  htmlFor,
  value,
  invalid,
  hint,
  placeholder,
  type = 'text',
  onChange,
}: {
  label: string
  optional?: boolean
  htmlFor: string
  value: string
  invalid: boolean
  hint: string
  placeholder?: string
  type?: 'text' | 'number'
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-[11px]">
        {label}
        {optional === true && (
          <span className="ml-1 font-normal text-muted-foreground">
            {t('workflows.start.optional')}
          </span>
        )}
      </Label>
      <Input
        id={htmlFor}
        className="bg-muted/45"
        type={type}
        value={value}
        aria-invalid={invalid}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {invalid && (
        <p role="status" className="text-[11px] text-destructive">
          {hint}
        </p>
      )}
    </div>
  )
}

/** The select's option list: editable rows, a remove per row and an add button. */
function StartVariableSelectOptions({
  options,
  invalid,
  hint,
  onChangeText,
  onRemove,
  onAdd,
}: {
  options: StartVariableOption[]
  invalid: boolean
  hint: string
  onChangeText: (optionId: number, text: string) => void
  onRemove: (optionId: number) => void
  onAdd: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      <Label className="text-[11px]">{t('workflows.start.options')}</Label>
      {options.map((option) => (
        <div key={option.id} className="flex items-center gap-2">
          <Input
            className="bg-muted/45"
            value={option.text}
            aria-label={t('workflows.start.option', { index: option.id + 1 })}
            onChange={(event) => onChangeText(option.id, event.target.value)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('workflows.start.deleteOption', { index: option.id + 1 })}
            onClick={() => onRemove(option.id)}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" className="w-full" onClick={onAdd}>
        <Plus className="size-3.5" />
        {t('workflows.start.addOption')}
      </Button>
      {invalid && (
        <p role="status" className="text-[11px] text-destructive">
          {hint}
        </p>
      )}
    </div>
  )
}

/**
 * The initial-value control, one per form control.
 *
 * Checkbox renders a real checkbox, paragraph / file-list / JSON a multi-line
 * textarea, select a picker over the option list, and everything else a single
 * line input. The error line beneath reports whichever check failed.
 */
function StartVariableValueControl({
  fieldType,
  valueType,
  valueText,
  selectOptions,
  parsedValue,
  exceedsMaxLength,
  maxLength,
  selectedValueInvalid,
  showErrors,
  onValueTextChange,
}: {
  fieldType: WorkflowInputFieldType
  valueType: WorkflowVariableValueType
  valueText: string
  selectOptions: string[]
  parsedValue: WorkflowVariableValueResult
  exceedsMaxLength: boolean
  maxLength: number | null
  selectedValueInvalid: boolean
  showErrors: boolean
  onValueTextChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const valueInvalid = showErrors && !parsedValue.valid
  return (
    <div className="space-y-1.5">
      <Label htmlFor="workflow-start-variable-value" className="text-[11px]">
        {t('workflows.start.initialValue')}
        <span className="ml-1 font-normal text-muted-foreground">
          {t('workflows.start.optional')}
        </span>
      </Label>
      <StartVariableControlInput
        fieldType={fieldType}
        valueType={valueType}
        valueText={valueText}
        selectOptions={selectOptions}
        valueInvalid={valueInvalid}
        exceedsMaxLength={exceedsMaxLength}
        onValueTextChange={onValueTextChange}
      />
      {valueInvalid && (
        <p role="status" className="text-[11px] text-destructive">
          {t('workflows.globalVariables.valueInvalid', { type: valueType })}
        </p>
      )}
      {showErrors && selectedValueInvalid && (
        <p role="status" className="text-[11px] text-destructive">
          {t('workflows.start.initialOptionInvalid')}
        </p>
      )}
      {showErrors && exceedsMaxLength && (
        <p role="status" className="text-[11px] text-destructive">
          {t('workflows.start.valueTooLong', { count: maxLength ?? 0 })}
        </p>
      )}
      <p className="text-[10px] leading-4 text-muted-foreground">
        {t('workflows.start.initialValueHint')}
      </p>
    </div>
  )
}

/**
 * The actual control of the initial value, one per form control.
 *
 * A switch rather than a ternary chain: checkbox renders a real checkbox,
 * paragraph / file-list / JSON a multi-line textarea, select a picker over the
 * option list, and everything else a single line input.
 */
function StartVariableControlInput({
  fieldType,
  valueType,
  valueText,
  selectOptions,
  valueInvalid,
  exceedsMaxLength,
  onValueTextChange,
}: {
  fieldType: WorkflowInputFieldType
  valueType: WorkflowVariableValueType
  valueText: string
  selectOptions: string[]
  valueInvalid: boolean
  exceedsMaxLength: boolean
  onValueTextChange: (value: string) => void
}) {
  switch (fieldType) {
    case 'checkbox':
      return (
        <StartVariableCheckboxValue
          checkedValue={valueText === 'true'}
          onToggle={(checked) => onValueTextChange(checked ? 'true' : 'false')}
        />
      )
    case 'paragraph':
    case 'file-list':
    case 'json':
      return (
        <Textarea
          id="workflow-start-variable-value"
          className="min-h-20 bg-muted/45"
          value={valueText}
          aria-invalid={valueInvalid || exceedsMaxLength}
          placeholder={workflowVariableValueExample(valueType)}
          onChange={(event) => onValueTextChange(event.target.value)}
        />
      )
    case 'select':
      return (
        <StartVariableSelectValue
          value={valueText}
          options={selectOptions}
          onValueChange={onValueTextChange}
        />
      )
    default:
      return (
        <Input
          id="workflow-start-variable-value"
          className="bg-muted/45"
          type={fieldType === 'number' ? 'number' : 'text'}
          value={valueText}
          aria-invalid={valueInvalid || exceedsMaxLength}
          placeholder={workflowVariableValueExample(valueType)}
          onChange={(event) => onValueTextChange(event.target.value)}
        />
      )
  }
}

/** A checkbox field's initial value, shown as a checked-literal toggle. */
function StartVariableCheckboxValue({
  checkedValue,
  onToggle,
}: {
  checkedValue: boolean
  onToggle: (checked: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <label className="flex h-10 items-center gap-2 rounded-md bg-muted/45 px-3 text-sm">
      <Checkbox checked={checkedValue} onCheckedChange={onToggle} />
      {checkedValue ? t('workflows.start.checked') : t('workflows.start.unchecked')}
    </label>
  )
}

/** A select field's initial value, restricted to the options the author listed. */
function StartVariableSelectValue({
  value,
  options,
  onValueChange,
}: {
  value: string
  options: string[]
  onValueChange: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <Select value={value === '' ? null : value} onValueChange={(next) => onValueChange(next ?? '')}>
      <SelectTrigger id="workflow-start-variable-value" className="w-full bg-muted/45">
        <SelectValue placeholder={t('workflows.start.noInitialValue')} />
      </SelectTrigger>
      <SelectContent>
        {options
          .filter((option) => option !== '')
          .map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}

/** Seeds the editable draft from the variable this session edits. */
function seedStartVariableDraft(variable: WorkflowInputVariable): StartVariableDraft {
  return {
    name: variable.name,
    displayName: variable.displayName ?? '',
    fieldType: resolveWorkflowInputFieldType(variable),
    required: variable.required ?? false,
    optionDrafts: (variable.options ?? []).map((text, index) => ({ id: index, text })),
    maxLengthText: variable.maxLength?.toString() ?? '',
    valueText: formatWorkflowVariableValue(variable.value, variable.valueType),
  }
}

/** Replaces the form control, dropping values the new control cannot hold. */
function changeFieldType(
  setDraft: Dispatch<SetStateAction<StartVariableDraft>>,
  next: WorkflowInputFieldType,
): void {
  setDraft((current) => ({
    ...current,
    fieldType: next,
    valueText: '',
    ...(next === 'select' ? {} : { optionDrafts: [] }),
  }))
}

/** Rewrites one option's text; the option objects keep their stable ids. */
function updateOptionText(
  current: StartVariableDraft,
  optionId: number,
  text: string,
): StartVariableDraft {
  return {
    ...current,
    optionDrafts: current.optionDrafts.map((option) =>
      option.id === optionId ? { id: option.id, text } : option,
    ),
  }
}

/** Drops one option from the working list. */
function removeOption(current: StartVariableDraft, optionId: number): StartVariableOption[] {
  return current.optionDrafts.filter((option) => option.id !== optionId)
}

/** Appends a fresh option whose id no existing one has claimed. */
function addOption(options: readonly StartVariableOption[]): StartVariableOption[] {
  return [...options, { id: nextOptionId(options), text: '' }]
}

/** The smallest id never handed to an option before. */
function nextOptionId(options: readonly StartVariableOption[]): number {
  return options.reduce((max, option) => (option.id > max ? option.id : max), 0) + 1
}

/** Whether the field type exposes a maximum-length limit to the author. */
function supportsMaxLength(fieldType: WorkflowInputFieldType): boolean {
  return fieldType === 'text-input' || fieldType === 'paragraph'
}

/** Computes every save-blocking check once per render, so sections share one answer. */
function validateStartVariableDraft(
  draft: StartVariableDraft,
  existingNames: string[],
): StartVariableValidation {
  const trimmedName = draft.name.trim()
  const parsedValue = parseWorkflowVariableValueText(
    draft.valueText,
    workflowInputFieldValueType(draft.fieldType),
  )
  const selectOptions = draft.optionDrafts.map((option) => option.text.trim())
  const nameInvalid = isInvalidVariableName(trimmedName, existingNames)
  const optionsInvalid = isInvalidSelectOptions(draft.fieldType, selectOptions)
  const parsedMaxLength = Number(draft.maxLengthText)
  const maxLengthInvalid = isInvalidMaxLength(draft.fieldType, draft.maxLengthText)
  const valueInvalid = hasInvalidInitialValue(draft, parsedValue, selectOptions)
  const canSave =
    !nameInvalid &&
    parsedValue.valid &&
    !maxLengthInvalid &&
    !valueInvalid.valueExceedsMaxLength &&
    !optionsInvalid &&
    !valueInvalid.selectedValueInvalid
  return {
    trimmedName,
    nameInvalid,
    parsedValue,
    selectOptions,
    optionsInvalid,
    maxLength: parsedMaxLength,
    maxLengthInvalid,
    valueExceedsMaxLength: valueInvalid.valueExceedsMaxLength,
    selectedValueInvalid: valueInvalid.selectedValueInvalid,
    canSave,
  }
}

/** A name is invalid when blank, contains a dot (reserved for scoping), or collides. */
function isInvalidVariableName(trimmedName: string, existingNames: string[]): boolean {
  return trimmedName === '' || trimmedName.includes('.') || existingNames.includes(trimmedName)
}

/** A select's options are invalid when none, blank, or duplicated. */
function isInvalidSelectOptions(
  fieldType: WorkflowInputFieldType,
  selectOptions: string[],
): boolean {
  return (
    fieldType === 'select' &&
    (selectOptions.length === 0 ||
      selectOptions.some((option) => option === '') ||
      new Set(selectOptions).size !== selectOptions.length)
  )
}

/** A max-length is invalid when non-numeric or below one, when one is expected. */
function isInvalidMaxLength(fieldType: WorkflowInputFieldType, text: string): boolean {
  return supportsMaxLength(fieldType) && text !== '' && (!/^\d+$/.test(text) || Number(text) < 1)
}

/**
 * Whether the initial value breaks either of its two rules: over the declared
 * max length, or — for a select — off the option list.
 */
function hasInvalidInitialValue(
  draft: StartVariableDraft,
  parsedValue: WorkflowVariableValueResult,
  selectOptions: string[],
): { valueExceedsMaxLength: boolean; selectedValueInvalid: boolean } {
  const parsedMaxLength = Number(draft.maxLengthText)
  const maxLengthInvalid = isInvalidMaxLength(draft.fieldType, draft.maxLengthText)
  const valueExceedsMaxLength =
    supportsMaxLength(draft.fieldType) &&
    !maxLengthInvalid &&
    draft.maxLengthText !== '' &&
    parsedValue.valid &&
    typeof parsedValue.value === 'string' &&
    Array.from(parsedValue.value).length > parsedMaxLength
  const selectedValueInvalid =
    draft.fieldType === 'select' &&
    parsedValue.valid &&
    typeof parsedValue.value === 'string' &&
    !selectOptions.includes(parsedValue.value)
  return { valueExceedsMaxLength, selectedValueInvalid }
}

/** Renders the draft into the wire shape the Start node stores. */
function commitStartVariable(
  draft: StartVariableDraft,
  validation: StartVariableValidation,
): WorkflowInputVariable {
  const valueType = workflowInputFieldValueType(draft.fieldType)
  const variable: WorkflowInputVariable = {
    name: validation.trimmedName,
    valueType,
    fieldType: draft.fieldType,
    required: draft.required,
    ...(draft.displayName.trim() === '' ? {} : { displayName: draft.displayName.trim() }),
    ...(draft.fieldType === 'select' ? { options: validation.selectOptions } : {}),
    ...(supportsMaxLength(draft.fieldType) && draft.maxLengthText !== ''
      ? { maxLength: Number(draft.maxLengthText) }
      : {}),
    ...(validation.parsedValue.valid && validation.parsedValue.value !== undefined
      ? { value: validation.parsedValue.value }
      : {}),
  }
  return variable
}

/** The supported form controls, as membership checkable against the wire strings. */
const IS_INPUT_FIELD_TYPES: ReadonlySet<string> = new Set<string>(WORKFLOW_INPUT_FIELD_TYPES)

/**
 * Narrows the select's nullable-value callback to a real form control.
 *
 * The base-ui Select reports the chosen value as `string | null`; a Set's
 * `.has()` membership check does not narrow the argument, so the guard turns a
 * stranger's string into a `WorkflowInputFieldType` all at once.
 */
function isWorkflowInputFieldType(value: string | null): value is WorkflowInputFieldType {
  return value !== null && IS_INPUT_FIELD_TYPES.has(value)
}
