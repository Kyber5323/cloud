import { useTranslation } from 'react-i18next'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  structuredOutputNestedObjectSchema,
  structuredOutputSchemaProperties,
  structuredOutputSchemaRequiredList,
  structuredOutputSchemaValueType,
  type StructuredOutputSchemaObject,
} from '@/features/workflows/editor/structured-output-schema-editor'

/**
 * The compact read-only preview of an Agent's structured output contract.
 *
 * Mirrors the same hierarchy the variable pool derives from the schema, so what
 * the author sees here is what a downstream node will be able to reference.
 */
export function WorkflowStructuredOutputSummary({
  schema,
  onConfigure,
}: {
  schema: StructuredOutputSchemaObject
  onConfigure: () => void
}) {
  const { t } = useTranslation()
  const properties = structuredOutputSchemaProperties(schema)
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <code className="truncate text-xs font-semibold">structured_output</code>
          <span className="text-[11px] text-muted-foreground">object</span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-xs"
          onClick={onConfigure}
        >
          <Pencil className="size-3.5" />
          {t('workflows.structuredOutput.configure')}
        </Button>
      </div>
      {Object.keys(properties).length === 0 ? (
        <div className="rounded-md bg-muted/60 px-3 py-2.5 text-center text-xs text-muted-foreground">
          {t('workflows.structuredOutput.unconfigured')}
        </div>
      ) : (
        <StructuredOutputSummaryFields schema={schema} depth={0} />
      )}
    </div>
  )
}

/** Renders one object's property rows, recursing into nested object shapes. */
function StructuredOutputSummaryFields({
  schema,
  depth,
}: {
  schema: StructuredOutputSchemaObject
  depth: number
}) {
  const { t } = useTranslation()
  const required = new Set(structuredOutputSchemaRequiredList(schema))
  return (
    <div
      className={depth === 0 ? 'border-l border-border pl-3' : 'ml-2 border-l border-border pl-3'}
    >
      {Object.entries(structuredOutputSchemaProperties(schema)).map(([name, field]) => {
        const type = structuredOutputSchemaValueType(field)
        const nested = structuredOutputNestedObjectSchema(field, type)
        const description = typeof field['description'] === 'string' ? field['description'] : ''
        return (
          <div key={name} className="py-1">
            <div className="flex flex-wrap items-baseline gap-2 text-xs">
              <code className="font-semibold">{name}</code>
              <span className="text-[11px] text-muted-foreground">{type}</span>
              {required.has(name) && (
                <span className="text-[10px] font-medium text-orange-600">
                  {t('workflows.structuredOutput.required')}
                </span>
              )}
            </div>
            {description !== '' && (
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{description}</p>
            )}
            {nested !== null && <StructuredOutputSummaryFields schema={nested} depth={depth + 1} />}
          </div>
        )
      })}
    </div>
  )
}
