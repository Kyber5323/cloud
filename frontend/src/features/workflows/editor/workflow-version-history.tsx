import { format } from 'date-fns'
import { History, RotateCcw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Workflow as CloudWorkflow, WorkflowSnapshot } from '@/api/generated.schemas'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useRestoreWorkflowSnapshot, useWorkflowSnapshots } from '@/features/workflows/api'
import { workflowErrorKey } from '@/features/workflows/error-messages'

/**
 * The workflow's published versions, newest first, each with a rollback action.
 *
 * Every snapshot is an immutable freeze of the graph at publish time; there is
 * no active-version mark, so "rolling back" means restoring that graph over the
 * live document — an edit that bumps the document version like any other write.
 * A confirmation guards the action because it replaces whatever is on the
 * canvas right now, unsaved changes included.
 *
 * @param props.tenantId - Tenant the workflow belongs to.
 * @param props.workflowId - Workflow whose history is shown.
 * @param props.committedVersion - Latest document version the server confirmed;
 * a stale workflow report makes the restore 409 rather than clobbering another
 * editor.
 * @param props.onRestored - Receives the workflow once its graph was replaced.
 */
export function WorkflowVersionHistory({
  tenantId,
  workflowId,
  committedVersion,
  onRestored,
}: {
  tenantId: string
  workflowId: string
  committedVersion: number
  onRestored: (workflow: CloudWorkflow) => void
}) {
  const { t } = useTranslation()
  const snapshots = useWorkflowSnapshots(tenantId, workflowId)
  const restore = useRestoreWorkflowSnapshot(tenantId)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [restoreTarget, setRestoreTarget] = useState<WorkflowSnapshot | null>(null)

  const visible = useMemo(() => {
    const list = snapshots.data ?? []
    const needle = query.trim().toLowerCase()
    if (needle === '') {
      return list
    }
    return list.filter(
      (snapshot) =>
        snapshot.name.toLowerCase().includes(needle) || String(snapshot.version).includes(needle),
    )
  }, [query, snapshots.data])

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setQuery('')
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              title={t('workflows.version.historyHint')}
              aria-label={t('workflows.version.history')}
            />
          }
        >
          <History className="size-4" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <VersionHistorySearch query={query} onQueryChange={setQuery} />
          <VersionHistoryList
            snapshots={visible}
            isPending={snapshots.isPending}
            onRollback={setRestoreTarget}
          />
        </PopoverContent>
      </Popover>
      <RestoreSnapshotDialog
        target={restoreTarget}
        isPending={restore.isPending}
        errorCode={restore.error?.response?.data?.code}
        onSettle={setRestoreTarget}
        onConfirm={(snapshot) => void confirmRestore(snapshot)}
      />
    </>
  )

  /** Writes the chosen snapshot's graph over the live document, then reloads. */
  async function confirmRestore(snapshot: WorkflowSnapshot): Promise<void> {
    try {
      const restored = await restore.mutateAsync({
        workflowId,
        snapshotId: snapshot.id,
        version: committedVersion,
      })
      setRestoreTarget(null)
      setOpen(false)
      onRestored(restored)
    } catch {
      // the fault line above the dialog footer already reports it
    }
  }
}

/** The popover's heading and the version-name search box. */
function VersionHistorySearch({
  query,
  onQueryChange,
}: {
  query: string
  onQueryChange: (query: string) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <div className="border-b border-border px-3 py-2.5">
        <h3 className="text-sm font-semibold">{t('workflows.version.history')}</h3>
      </div>
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            aria-label={t('workflows.version.historySearch')}
            placeholder={t('workflows.version.historySearch')}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>
    </>
  )
}

/** The snapshot list body: loading, empty, or the rollback rows. */
function VersionHistoryList({
  snapshots,
  isPending,
  onRollback,
}: {
  snapshots: WorkflowSnapshot[]
  isPending: boolean
  onRollback: (snapshot: WorkflowSnapshot) => void
}) {
  const { t } = useTranslation()
  if (snapshots.length === 0) {
    return (
      <ScrollArea className="max-h-72 min-w-fit p-2">
        <p className="px-2.5 py-3 text-xs text-muted-foreground">
          {isPending ? t('workflows.detail.loading') : t('workflows.version.historyEmpty')}
        </p>
      </ScrollArea>
    )
  }
  return (
    <ScrollArea className="max-h-72 min-w-fit p-2">
      <ul className="space-y-1">
        {snapshots.map((snapshot) => (
          <li key={snapshot.id}>
            <button
              type="button"
              aria-label={t('workflows.version.rollbackNamed', {
                version: snapshot.version,
              })}
              onClick={() => onRollback(snapshot)}
              className="w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate text-xs font-medium">
                  #{snapshot.version} {snapshot.name}
                </span>
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {t('workflows.version.publishedAt', {
                  time: format(new Date(snapshot.createdAt), 'M月d日 HH:mm'),
                })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </ScrollArea>
  )
}

/** The confirmation guarding a rollback, with a fault line for restore errors. */
function RestoreSnapshotDialog({
  target,
  isPending,
  errorCode,
  onSettle,
  onConfirm,
}: {
  /** The snapshot about to be restored, or `null` while the dialog is closed. */
  target: WorkflowSnapshot | null
  /** Whether the restore request is in flight. */
  isPending: boolean
  /** Backend fault code from the last failed restore, if any. */
  errorCode: string | undefined
  /** Receives the new dialog state; `null` closes it. */
  onSettle: (target: WorkflowSnapshot | null) => void
  /** Carries the confirmed snapshot to the restore call. */
  onConfirm: (snapshot: WorkflowSnapshot) => void
}) {
  const { t } = useTranslation()
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) {
          onSettle(null)
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('workflows.version.restoreTitle', {
              version: target?.version ?? '',
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('workflows.version.restoreDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {errorCode && <p className="text-xs text-destructive">{t(workflowErrorKey(errorCode))}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('workflows.list.cancel')}</AlertDialogCancel>
          {/* A plain button, not the dialog's Close action: a rejected restore
              must leave the confirmation open so the fault line is readable. */}
          <Button
            disabled={isPending}
            onClick={() => {
              if (target !== null) {
                onConfirm(target)
              }
            }}
          >
            <RotateCcw className="size-3.5" />
            {t('workflows.version.restore')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
