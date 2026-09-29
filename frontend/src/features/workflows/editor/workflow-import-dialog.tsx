import { useState, type DragEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleAlert, CircleCheck, CloudUpload, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useCreateWorkflow, usePublishWorkflow } from '@/features/workflows/api'
import { workflowErrorKey } from '@/features/workflows/error-messages'
import { serializeWorkflowGraphValue } from '@/features/workflows/runtime/graph-codec'
import type { Error as ApiError } from '@/api/generated.schemas'
import type { ImportedWorkflowDocument } from '@/features/workflows/runtime/graph-import'
import type { ErrorType } from '@/lib/api-client'
import {
  formatWorkflowFileSize,
  readWorkflowImportFile,
  summarizeWorkflowTransfer,
  type WorkflowImportFailure,
  type WorkflowImportFileInfo,
} from '@/features/workflows/editor/workflow-transfer'

/** Accepted file types, also shown by the native picker. */
const ACCEPTED_FILE_TYPES = '.json,application/json'

/** The import journey: choose a file, then review a parsed workflow or read why it failed. */
type ImportStage =
  | { stage: 'pick' }
  | { stage: 'preview'; file: WorkflowImportFileInfo; document: ImportedWorkflowDocument }
  | { stage: 'failure'; file: WorkflowImportFileInfo; failure: WorkflowImportFailure }

/**
 * Imports an exported workflow file as a new workflow.
 *
 * Import is a small state machine — pick a file, then either review the parsed
 * workflow or read why the file was refused. Nothing is persisted before the
 * preview is confirmed, and the imported graph becomes a brand-new workflow
 * rather than replacing the one being edited. Publishing after import is
 * optional and creates the first immutable version of the new document.
 *
 * @param props.tenantId - Tenant the imported workflow belongs to.
 * @param props.open - Whether the dialog is showing.
 * @param props.onOpenChange - Receives the next open state.
 * @param props.onImported - Receives the id of the created workflow.
 */
export function WorkflowImportDialog({
  tenantId,
  open,
  onOpenChange,
  onImported,
}: {
  tenantId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (workflowId: string) => void
}) {
  const createWorkflow = useCreateWorkflow(tenantId)
  const publishWorkflow = usePublishWorkflow(tenantId)
  const [stage, setStage] = useState<ImportStage>({ stage: 'pick' })

  function handleOpenChange(next: boolean): void {
    if (!next) {
      setStage({ stage: 'pick' })
      onOpenChange(false)
    }
  }

  /** Reads a picked file and moves to a preview or a failure explanation. */
  async function selectFile(file: File): Promise<void> {
    const result = await readWorkflowImportFile(file)
    if (result.parse.ok) {
      setStage({ stage: 'preview', file: result.file, document: result.parse.document })
    } else {
      setStage({ stage: 'failure', file: result.file, failure: result.parse.failure })
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {stage.stage === 'pick' && (
          <PickStage
            onFile={(file) => void selectFile(file)}
            onCancel={() => handleOpenChange(false)}
          />
        )}
        {stage.stage === 'failure' && (
          <FailureStage
            file={stage.file}
            failure={stage.failure}
            onPickAgain={() => setStage({ stage: 'pick' })}
            onClose={() => handleOpenChange(false)}
          />
        )}
        {stage.stage === 'preview' && (
          <PreviewStage
            file={stage.file}
            document={stage.document}
            busy={createWorkflow.isPending || publishWorkflow.isPending}
            errorCode={apiErrorCode(createWorkflow.error) ?? apiErrorCode(publishWorkflow.error)}
            onPickAgain={() => setStage({ stage: 'pick' })}
            onCancel={() => handleOpenChange(false)}
            onConfirm={async (choices) => {
              try {
                const created = await createWorkflow.mutateAsync({
                  name: choices.name,
                  ...(choices.description === '' ? {} : { description: choices.description }),
                  graph: importedGraph(stage.document),
                })
                if (choices.publish) {
                  await publishWorkflow.mutateAsync({ workflowId: created.resource.id })
                }
                handleOpenChange(false)
                onImported(created.resource.id)
              } catch {
                // the fault line above the footer already reports it
              }
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Reads the fault code out of a mutation error, when the API produced one. */
function apiErrorCode(error: ErrorType<ApiError> | null): string | undefined {
  return error?.response?.data?.code
}

/** The workflow decisions collected before anything is created. */
interface ImportChoices {
  name: string
  description: string
  /** Also freeze the imported graph as the first published version. */
  publish: boolean
}

/** Turns a validated import into the graph document the API stores. */
function importedGraph(document: ImportedWorkflowDocument): Record<string, unknown> {
  return serializeWorkflowGraphValue({
    nodes: document.definition.nodes,
    edges: document.definition.edges,
    viewport: document.definition.viewport,
    annotations: document.annotations,
    launchFields: document.launchFields,
    ...(document.definition.globalVariables === undefined
      ? {}
      : { globalVariables: document.definition.globalVariables }),
    ...(document.definition.description === ''
      ? {}
      : { description: document.definition.description }),
  })
}

/** Title block shared by every stage. */
function StageHeader({
  title,
  description,
  mono = false,
}: {
  title: string
  description: string
  mono?: boolean
}) {
  return (
    <DialogHeader>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription className={mono ? 'font-mono' : undefined}>
        {description}
      </DialogDescription>
    </DialogHeader>
  )
}

/** Footer with an explicit rule, matching the header's gutters. */
function StageFooter({ children }: { children: ReactNode }) {
  return <DialogFooter>{children}</DialogFooter>
}

/** Reads the first file from a browser drop. */
function fileFromDataTransfer(dataTransfer: DataTransfer): File | undefined {
  const [listed] = Array.from(dataTransfer.files)
  if (listed !== undefined) {
    return listed
  }
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file !== null) {
        return file
      }
    }
  }
  return undefined
}

/** A drop zone that also opens the native picker. */
function PickStage({ onFile, onCancel }: { onFile: (file: File) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const [dragging, setDragging] = useState(false)

  function drop(event: DragEvent<HTMLElement>): void {
    event.preventDefault()
    setDragging(false)
    const file = fileFromDataTransfer(event.dataTransfer)
    if (file !== undefined) {
      onFile(file)
    }
  }

  return (
    <>
      <StageHeader
        title={t('workflows.transfer.importTitle')}
        description={t('workflows.transfer.pickDescription')}
      />
      <label
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(event) => {
          const related = event.relatedTarget
          if (
            related !== null &&
            related instanceof Node &&
            !event.currentTarget.contains(related)
          ) {
            setDragging(false)
          }
        }}
        onDrop={drop}
        className={`grid cursor-pointer justify-items-center gap-1.5 rounded-lg border-[1.5px] border-dashed bg-muted px-4 py-8 text-center outline-none focus-within:ring-2 focus-within:ring-ring ${dragging ? 'border-primary' : 'border-border'}`}
      >
        <CloudUpload className="size-7 text-muted-foreground" strokeWidth={1.6} />
        <strong className="text-sm font-semibold">{t('workflows.transfer.dropZoneTitle')}</strong>
        <span className="text-sm text-muted-foreground">
          {t('workflows.transfer.dropZoneHint')}
        </span>
        <input
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          className="sr-only"
          aria-label={t('workflows.transfer.dropZoneTitle')}
          onChange={(event) => {
            const [file] = Array.from(event.target.files ?? [])
            event.target.value = ''
            if (file !== undefined) {
              onFile(file)
            }
          }}
        />
      </label>
      <StageFooter>
        <span className="flex-1" />
        <Button variant="outline" onClick={onCancel}>
          {t('workflows.list.cancel')}
        </Button>
      </StageFooter>
    </>
  )
}

/** Explains a rejected file; nothing has been persisted at this point. */
function FailureStage({
  file,
  failure,
  onPickAgain,
  onClose,
}: {
  file: WorkflowImportFileInfo
  failure: WorkflowImportFailure
  onPickAgain: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const location = failure.reason === 'invalidJson' ? failure.location : null
  // Modern engines report the fault without a character position, so the
  // line/column excerpt is optional; each reason gets its own message then.
  let detail: string
  if (failure.reason === 'invalidJson' && location !== null) {
    detail = t('workflows.transfer.failure.invalidJsonAt', {
      line: location.line,
      column: location.column,
    })
  } else if (failure.reason === 'invalidJson') {
    detail = t('workflows.transfer.failure.invalidJsonDetail')
  } else if (failure.reason === 'invalidWorkflow') {
    detail = failure.issues.join('；')
  } else {
    detail = t('workflows.transfer.failure.fileTooLargeDetail')
  }
  return (
    <>
      <StageHeader
        title={t('workflows.transfer.importFailedTitle')}
        description={`${file.name} · ${formatWorkflowFileSize(file.size)}`}
        mono
      />
      <div className="flex flex-col gap-3">
        <div
          role="alert"
          className="flex gap-2.5 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <strong className="block font-semibold">
              {t(`workflows.transfer.failure.${failure.reason}`)}
            </strong>
            {detail}
          </div>
        </div>
        {location !== null && (
          <div className="overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2.5 font-mono text-xs">
            {location.excerpt.map((line) => (
              <div key={line.number} className="whitespace-pre">
                <span className="mr-3 text-muted-foreground">{line.number}</span>
                {line.number === location.line ? (
                  <>
                    {line.text.slice(0, location.column - 1)}
                    <mark className="rounded-[3px] bg-destructive/10 px-0.5 text-destructive">
                      {line.text.charAt(location.column - 1) || ' '}
                    </mark>
                    {line.text.slice(location.column)}
                  </>
                ) : (
                  line.text
                )}
              </div>
            ))}
          </div>
        )}
        <p className="text-sm text-muted-foreground">{t('workflows.transfer.failureNote')}</p>
      </div>
      <StageFooter>
        <span className="flex-1" />
        <Button variant="outline" onClick={onClose}>
          {t('workflows.transfer.close')}
        </Button>
        <Button onClick={onPickAgain}>{t('workflows.transfer.chooseOtherFile')}</Button>
      </StageFooter>
    </>
  )
}

/** Review step: an editable name, a content summary, and the publish choice. */
function PreviewStage({
  file,
  document,
  busy,
  errorCode,
  onPickAgain,
  onCancel,
  onConfirm,
}: {
  file: WorkflowImportFileInfo
  document: ImportedWorkflowDocument
  busy: boolean
  errorCode: string | undefined
  onPickAgain: () => void
  onCancel: () => void
  onConfirm: (choices: ImportChoices) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(document.definition.name)
  const [publish, setPublish] = useState(true)
  const summary = summarizeWorkflowTransfer(document)
  const canConfirm = name.trim() !== '' && !busy
  const description = document.definition.description

  const summaryRows: readonly { count: number; label: string }[] = [
    { count: summary.nodeCount, label: t('workflows.transfer.summaryNodes') },
    { count: summary.agentCount, label: t('workflows.transfer.summaryAgents') },
    { count: summary.globalVariableCount, label: t('workflows.transfer.summaryGlobals') },
  ]

  return (
    <>
      <StageHeader
        title={t('workflows.transfer.previewTitle')}
        description={`${file.name} · ${formatWorkflowFileSize(file.size)}`}
        mono
      />
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">
            {t('workflows.transfer.workflowName')}
          </span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canConfirm) {
                event.preventDefault()
                void onConfirm({ name: name.trim(), description, publish })
              }
            }}
          />
        </label>
        {description !== '' && <p className="text-sm text-muted-foreground">{description}</p>}
        <dl className="grid grid-cols-3 overflow-hidden rounded-lg border border-border">
          {summaryRows.map((row) => (
            <div key={row.label} className="flex flex-col-reverse px-3 py-2">
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd className="text-base font-semibold tabular-nums">{row.count}</dd>
            </div>
          ))}
        </dl>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox
            checked={publish}
            onCheckedChange={(checked) => setPublish(checked)}
            disabled={busy}
            className="mt-0.5"
          />
          <span>
            {t('workflows.transfer.publishAfterImport')}
            <span className="block text-muted-foreground">
              {t('workflows.transfer.publishAfterImportHint')}
            </span>
          </span>
        </label>
        <div className="flex gap-2.5 rounded-lg bg-blue-500/10 px-3 py-2.5 text-xs leading-normal text-blue-700 dark:text-blue-300">
          <Info className="mt-0.5 size-4 shrink-0" />
          <div>{t('workflows.transfer.importAsNewBetweenInfo')}</div>
        </div>
        {errorCode && <p className="text-xs text-destructive">{t(workflowErrorKey(errorCode))}</p>}
      </div>
      <StageFooter>
        <Button variant="outline" disabled={busy} onClick={onPickAgain}>
          {t('workflows.transfer.chooseAgain')}
        </Button>
        <span className="flex-1" />
        <Button variant="outline" disabled={busy} onClick={onCancel}>
          {t('workflows.list.cancel')}
        </Button>
        <Button
          disabled={!canConfirm}
          onClick={() => void onConfirm({ name: name.trim(), description, publish })}
        >
          <CircleCheck className="size-3.5" />
          {t('workflows.transfer.confirmImport')}
        </Button>
      </StageFooter>
    </>
  )
}
