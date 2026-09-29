import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { History, Redo2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { WorkflowHistoryControls } from '@/features/workflows/editor/use-workflow-editor-state'
import type { TranslationKey } from '@/i18n/i18n-instance'
import type {
  WorkflowHistoryEvent,
  WorkflowHistoryMeta,
  WorkflowHistoryStep,
} from '@/features/workflows/editor/workflow-history'

/** One line of the change-history panel, newest first. */
interface HistoryRow {
  id: string
  direction: 'past' | 'future' | 'current'
  /** How many undo/redo steps the row restores when picked. */
  steps: number
  event: WorkflowHistoryEvent | null
  meta: WorkflowHistoryMeta | undefined
}

/**
 * Session undo/redo: two toolbar buttons, a keyboard route, and a change list.
 *
 * The keyboard effect is a deliberate refinement over the desktop editor: when a
 * form field holds focus the browser's own text undo must keep working, so the
 * shortcut yields to inputs and other text-editing targets. On the canvas it
 * applies as expected (Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z and Ctrl+Y redo).
 *
 * @param history - The session stacks and actions, published by the editor state.
 */
export function WorkflowHistoryTools({ history }: { history: WorkflowHistoryControls }) {
  const { t } = useTranslation()
  useHistoryKeyboard(history.undo, history.redo)
  const rows = buildHistoryRows(
    history.past,
    history.future,
    history.currentEvent,
    history.currentMeta,
  )

  return (
    <Popover>
      <div className="flex items-center gap-0.5">
        <Button
          variant="outline"
          size="icon"
          disabled={!history.canUndo}
          aria-label={t('workflows.history.undo')}
          title={`${t('workflows.history.undo')}（${t('workflows.history.undoHint')}）`}
          onClick={history.undo}
        >
          <Undo2 className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          disabled={!history.canRedo}
          aria-label={t('workflows.history.redo')}
          title={`${t('workflows.history.redo')}（${t('workflows.history.redoHint')}）`}
          onClick={history.redo}
        >
          <Redo2 className="size-4" />
        </Button>
        <div className="mx-1 h-5 w-px bg-border" aria-hidden />
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              title={t('workflows.history.historyHint')}
              aria-label={t('workflows.history.history')}
            />
          }
        >
          <History className="size-4" />
        </PopoverTrigger>
      </div>
      <PopoverContent align="end" className="w-72 p-0">
        <HistoryPanel rows={rows} onJump={history.jump} onClear={history.clear} />
      </PopoverContent>
    </Popover>
  )
}

/**
 * Binds the session undo/redo shortcuts while the editor is mounted.
 *
 * The handlers rerun only when their closures change; since the editor state
 * publishes fresh ones each render, the window listener is re-armed with the
 * latest while the document is open. Form fields keep their native text undo.
 *
 * @param undo - Restores the previous step.
 * @param redo - Re-applies the next step.
 */
function useHistoryKeyboard(undo: () => void, redo: () => void): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.isComposing || !(event.ctrlKey || event.metaKey)) {
        return
      }
      const target = event.target instanceof Element ? event.target : window.document.activeElement
      if (target instanceof Element && isTextEditingTarget(target)) {
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          redo()
        } else {
          undo()
        }
      } else if (key === 'y') {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [redo, undo])
}

/** Whether a keyboard event should be left to the browser's native editing. */
function isTextEditingTarget(target: Element): boolean {
  if (target instanceof HTMLElement && target.isContentEditable) {
    return true
  }
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}

/** Converts the stacks into newest-first panel rows with jump step counts. */
function buildHistoryRows(
  past: WorkflowHistoryStep[],
  future: WorkflowHistoryStep[],
  currentEvent: WorkflowHistoryEvent | null,
  currentMeta: WorkflowHistoryMeta | undefined,
): HistoryRow[] {
  return [
    ...future.map((step, index) => ({
      id: `future-${step.id}`,
      direction: 'future' as const,
      // Future is newest-first: each undo appends the operation just left, so
      // the count of redo steps grows toward the oldest (last) element.
      steps: future.length - index,
      event: step.event,
      meta: step.meta,
    })),
    {
      id: 'current',
      direction: 'current',
      steps: 0,
      event: currentEvent,
      meta: currentMeta,
    },
    ...past.toReversed().map((step, index) => ({
      id: `past-${step.id}`,
      direction: 'past' as const,
      steps: index + 1,
      // A past snapshot is the state before its own edit, so its label is the
      // preceding edit (or the session baseline for the oldest row).
      event: past[past.length - index - 2]?.event ?? null,
      meta: past[past.length - index - 2]?.meta,
    })),
  ]
}

/** Renders the change-history popover body: rows and the clear action. */
function HistoryPanel({
  rows,
  onJump,
  onClear,
}: {
  rows: HistoryRow[]
  onJump: (direction: 'past' | 'future', steps: number) => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  if (rows.length === 1) {
    return (
      <ScrollArea className="max-h-72 min-w-fit p-2">
        <p className="px-2.5 py-3 text-xs text-muted-foreground">{t('workflows.history.empty')}</p>
      </ScrollArea>
    )
  }
  return (
    <>
      <div className="max-h-72 overflow-y-auto p-1.5">
        {rows.map((row) => (
          <HistoryRowItem key={row.id} row={row} onJump={onJump} />
        ))}
      </div>
      <div className="border-t border-border p-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-xs"
          onClick={onClear}
        >
          {t('workflows.history.clear')}
        </Button>
      </div>
    </>
  )
}

/** One jumpable line of change history, labeled with the edit it lands on. */
function HistoryRowItem({
  row,
  onJump,
}: {
  row: HistoryRow
  onJump: (direction: 'past' | 'future', steps: number) => void
}) {
  const { t } = useTranslation()
  const current = row.direction === 'current'
  const label =
    row.event === null
      ? t('workflows.history.sessionStart')
      : `${t(historyEventLabel(row.event))}：${subjectFor(row.meta)}`
  let distance: string
  if (current) {
    distance = t('workflows.history.current')
  } else if (row.direction === 'past') {
    distance = t('workflows.history.stepsBack', { count: row.steps })
  } else {
    distance = t('workflows.history.stepsForward', { count: row.steps })
  }
  const text = `${label}(${distance})`
  return (
    <button
      type="button"
      disabled={current}
      onClick={() => {
        if (row.direction !== 'current') {
          onJump(row.direction, row.steps)
        }
      }}
      title={text}
      className={`flex w-full items-start rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
        current ? 'bg-muted text-foreground' : 'hover:bg-muted/70'
      }`}
    >
      <span className="min-w-0 truncate">{text}</span>
    </button>
  )
}

/** The translation key naming one event type, stable across the bundles. */
function historyEventLabel(event: WorkflowHistoryEvent): TranslationKey {
  const keys: Record<WorkflowHistoryEvent, TranslationKey> = {
    'node.add': 'workflows.history.eventNodeAdd',
    'node.delete': 'workflows.history.eventNodeDelete',
    'edge.delete': 'workflows.history.eventEdgeDelete',
    'edge.connect': 'workflows.history.eventEdgeConnect',
    'node.move': 'workflows.history.eventNodeMove',
    'iteration.resize': 'workflows.history.eventIterationResize',
    'layout.organize': 'workflows.history.eventOrganize',
    'node.edit': 'workflows.history.eventNodeEdit',
    'workflow.variables': 'workflows.history.eventVariables',
    'workflow.launchFields': 'workflows.history.eventLaunchFields',
  }
  return keys[event]
}

/** The named subject a step records, or an empty string when it has none. */
function subjectFor(meta: WorkflowHistoryMeta | undefined): string {
  return meta?.subject ?? ''
}
