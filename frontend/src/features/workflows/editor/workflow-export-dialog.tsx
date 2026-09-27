import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Info } from 'lucide-react'
import type { Workflow as CloudWorkflow } from '@/api/generated.schemas'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useWorkflowSnapshots } from '@/features/workflows/api'
import {
  workflowExportDocument,
  workflowExportFileName,
} from '@/features/workflows/editor/workflow-transfer'

/** One row of the export-source picker: the draft, or a numbered version. */
export interface WorkflowExportOption {
  version: number | null
  label: string
  detail: string
}

/** Creates a browser download of the document without a server round-trip. */
function downloadWorkflowDocument(doc: Record<string, unknown>, fileName: string): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = globalThis.document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Exports the workflow as a portable `.reactflow.json` file.
 *
 * The source is either the live draft, unsaved edits included, or a published
 * version's frozen graph. The export name is derived from the workflow and, for
 * a version, its number, so exporting several versions never collides on disk.
 * Nothing is sent to the server: the file is built and downloaded locally.
 *
 * @param props.tenantId - Tenant the workflow belongs to; scopes the version list.
 * @param props.workflow - Workflow whose draft or versions are exported.
 * @param props.draftGraph - Serializes the live draft; the dialog calls it lazily.
 * @param props.open - Whether the dialog is showing.
 * @param props.onOpenChange - Receives the next open state.
 */
export function WorkflowExportDialog({
  tenantId,
  workflow,
  draftGraph,
  open,
  onOpenChange,
}: {
  tenantId: string
  workflow: CloudWorkflow
  draftGraph: () => Record<string, unknown>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const snapshots = useWorkflowSnapshots(tenantId, workflow.id)
  // `null` selects the live draft; a number selects that published version.
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [fileName, setFileName] = useState(() => workflowExportFileName(workflow.name, null))
  // The query data is referentially stable, so the empty default is the only fresh value.
  const versions = useMemo(() => snapshots.data ?? [], [snapshots.data])

  const options = useMemo(
    () => [
      {
        version: null as number | null,
        label: t('workflows.transfer.currentDraft'),
        detail: t('workflows.transfer.currentDraftHint'),
      },
      ...versions.map((snapshot) => ({
        version: snapshot.version,
        label: t('workflows.transfer.versionOption', { version: snapshot.version }),
        detail: t('workflows.transfer.publishedOption', {
          version: snapshot.version,
        }),
      })),
    ],
    [t, versions],
  )

  /** The graph document the export will write, or `null` while a version loads. */
  const document = useMemo(() => {
    if (selectedVersion === null) {
      return workflowExportDocument(workflow, draftGraph())
    }
    const snapshot = versions.find((candidate) => candidate.version === selectedVersion)
    return snapshot === undefined ? null : workflowExportDocument(workflow, snapshot.graph)
  }, [draftGraph, selectedVersion, versions, workflow])

  const previewJson = document === null ? null : JSON.stringify(document, null, 2)

  /** Switches the source and proposes a matching file name. */
  function select(version: number | null): void {
    setSelectedVersion(version)
    setFileName(workflowExportFileName(workflow.name, version))
  }

  function confirm(): void {
    if (document === null || fileName.trim() === '') {
      return
    }
    downloadWorkflowDocument(document, fileName.trim())
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('workflows.transfer.exportTitle', { name: workflow.name })}</DialogTitle>
          <DialogDescription>{t('workflows.transfer.exportDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          <ExportSourceList options={options} selectedVersion={selectedVersion} onSelect={select} />
          <ExportFileAndPreview
            fileName={fileName}
            previewJson={previewJson}
            onFileNameChange={setFileName}
          />
          <div className="flex gap-2.5 rounded-lg bg-blue-500/10 px-3 py-2.5 text-xs leading-normal text-blue-700 dark:text-blue-300">
            <Info className="mt-0.5 size-4 shrink-0" />
            <div>{t('workflows.transfer.referenceOnlyNotice')}</div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('workflows.list.cancel')}
          </Button>
          <Button disabled={previewJson === null || fileName.trim() === ''} onClick={confirm}>
            <Download className="size-3.5" />
            {t('workflows.transfer.confirmExport')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The radio list of sources to export: the live draft plus every published version. */
function ExportSourceList({
  options,
  selectedVersion,
  onSelect,
}: {
  options: readonly WorkflowExportOption[]
  selectedVersion: number | null
  onSelect: (version: number | null) => void
}) {
  const { t } = useTranslation()
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">{t('workflows.transfer.exportSource')}</legend>
      <div
        role="radiogroup"
        aria-label={t('workflows.transfer.exportSource')}
        className="grid gap-1.5"
      >
        {options.map((option) => {
          const checked = option.version === selectedVersion
          return (
            <button
              key={option.version ?? 'draft'}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onSelect(option.version)}
              className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-lg border px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden
                className={`flex size-3.5 items-center justify-center rounded-full border ${checked ? 'border-primary' : 'border-muted-foreground'}`}
              >
                {checked && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{option.label}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {option.detail}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

/** The editable file name and the collapsible structure preview. */
function ExportFileAndPreview({
  fileName,
  previewJson,
  onFileNameChange,
}: {
  fileName: string
  previewJson: string | null
  onFileNameChange: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">{t('workflows.transfer.fileName')}</span>
        <Input
          value={fileName}
          onChange={(event) => onFileNameChange(event.target.value)}
          className="font-mono"
        />
      </label>
      {previewJson === null ? (
        <p className="text-xs text-muted-foreground">{t('workflows.transfer.loadingVersion')}</p>
      ) : (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            {t('workflows.transfer.previewStructure')}
          </summary>
          <pre className="mt-2 max-h-[170px] overflow-auto rounded-lg border border-border bg-muted/40 px-3 py-2.5 font-mono text-xs whitespace-pre">
            {previewJson}
          </pre>
        </details>
      )}
    </>
  )
}
