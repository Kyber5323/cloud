import { useCallback, useRef, useState, type MutableRefObject } from 'react'
import type {
  WorkflowHistoryEvent,
  WorkflowHistoryMeta,
  WorkflowHistorySnapshot,
  WorkflowHistoryState,
  WorkflowHistoryStep,
} from '@/features/workflows/editor/workflow-history'
import {
  commitWorkflowHistory,
  createWorkflowHistoryState,
  redoWorkflowHistory,
  undoWorkflowHistory,
  workflowHistoryFingerprint,
} from '@/features/workflows/editor/workflow-history'

/** A transaction whose content is committed only once the gesture ends. */
interface PendingWorkflowTransaction {
  before: WorkflowHistorySnapshot
  event: WorkflowHistoryEvent
  // A required `| undefined` (not an optional) so a gesture without context can
  // store `meta: undefined` without tripping `exactOptionalPropertyTypes`.
  meta: WorkflowHistoryMeta | undefined
}

type WorkflowHistoryDirection = 'past' | 'future'

/** How long two keystrokes on the same field merge into one history step. */
const HISTORY_GROUP_WINDOW_MS = 500

/** The portion of the history the editor mounts buttons against. */
export interface WorkflowHistoryPublished {
  canUndo: boolean
  canRedo: boolean
  past: WorkflowHistoryStep[]
  future: WorkflowHistoryStep[]
  currentEvent: WorkflowHistoryEvent | null
  currentMeta: WorkflowHistoryMeta | undefined
}

/** Refs the gesture recorders share, so a sub-hook stays under the param cap. */
interface HistorySessionRefs {
  history: MutableRefObject<WorkflowHistoryState>
  activeGroup: MutableRefObject<string | null>
  activeGroupAt: MutableRefObject<number>
}

/** The published surface of a brand-new session: no steps, nothing current. */
const EMPTY_PUBLISHED: WorkflowHistoryPublished = {
  canUndo: false,
  canRedo: false,
  past: [],
  future: [],
  currentEvent: null,
  currentMeta: undefined,
}

/** The commit arguments for one recorded edit, meta applied only when present. */
function historyCommit(
  before: WorkflowHistorySnapshot,
  after: WorkflowHistorySnapshot,
  event: WorkflowHistoryEvent,
  meta?: WorkflowHistoryMeta,
) {
  return meta === undefined ? { before, after, event } : { before, after, event, meta }
}

/**
 * One editor session's undo/redo history, owned by refs while React renders it.
 * A transaction brackets one multi-frame gesture; a group window merges the
 * keystrokes of a single focused field.
 *
 * @param onRestore - Receives the snapshot undo/redo/jump chose; it replaces the
 * current graph content and schedules the autosave.
 */
export function useWorkflowHistory(onRestore: (snapshot: WorkflowHistorySnapshot) => void) {
  const historyRef = useRef<WorkflowHistoryState>(createWorkflowHistoryState())
  const transactionRef = useRef<PendingWorkflowTransaction | null>(null)
  const activeGroupRef = useRef<string | null>(null)
  const activeGroupAtRef = useRef(0)
  const [published, setPublished] = useState<WorkflowHistoryPublished>(EMPTY_PUBLISHED)

  /** Publishes stack changes and the event the current content landed on. */
  const notify = useCallback(
    (currentEvent: WorkflowHistoryEvent | null, currentMeta: WorkflowHistoryMeta | undefined) => {
      const history = historyRef.current
      setPublished({
        canUndo: history.past.length > 0,
        canRedo: history.future.length > 0,
        past: history.past,
        future: history.future,
        currentEvent,
        currentMeta,
      })
    },
    [],
  )

  /** Drops the stacks while keeping the current workflow content unchanged. */
  const clear = useCallback((): void => {
    historyRef.current = createWorkflowHistoryState()
    transactionRef.current = null
    activeGroupRef.current = null
    activeGroupAtRef.current = 0
    notify(null, undefined)
  }, [notify])

  /**
   * Commits a completed discrete edit. Fields that keep emitting (typing) can
   * pass `group`, so repeats inside the window replace the previous step.
   */
  const record = useCallback(
    (
      before: WorkflowHistorySnapshot,
      after: WorkflowHistorySnapshot,
      event: WorkflowHistoryEvent,
      options?: { meta?: WorkflowHistoryMeta; group?: string },
    ): void => {
      if (workflowHistoryFingerprint(before) === workflowHistoryFingerprint(after)) {
        return
      }
      const { meta, group } = options ?? {}
      // Text inputs report one update per keystroke. Reusing the first step for
      // a focused field keeps undo aligned with intent instead of a keypress.
      if (coalesces(historyRef.current.past.length, activeGroupRef, activeGroupAtRef, group)) {
        notify(event, meta)
        return
      }
      const changes = historyCommit(before, after, event, meta)
      historyRef.current = commitWorkflowHistory(historyRef.current, changes)
      activeGroupRef.current = group ?? null
      activeGroupAtRef.current = group === undefined ? 0 : Date.now()
      notify(event, meta)
    },
    [notify],
  )

  /** Starts a transaction used for gestures that emit many intermediate states. */
  const beginTransaction = useCallback(
    (
      before: WorkflowHistorySnapshot,
      event: WorkflowHistoryEvent,
      meta?: WorkflowHistoryMeta,
    ): void => {
      transactionRef.current = { before, event, meta }
      activeGroupRef.current = null
      activeGroupAtRef.current = 0
    },
    [],
  )

  /** Commits the pending transaction as one history step when its content differs. */
  const commitTransaction = useCallback(
    (after: WorkflowHistorySnapshot): void => {
      const transaction = transactionRef.current
      transactionRef.current = null
      if (
        transaction === null ||
        workflowHistoryFingerprint(transaction.before) === workflowHistoryFingerprint(after)
      ) {
        return
      }
      const changes = historyCommit(transaction.before, after, transaction.event, transaction.meta)
      historyRef.current = commitWorkflowHistory(historyRef.current, changes)
      notify(transaction.event, transaction.meta)
    },
    [notify],
  )

  /** Ends the current coalescing window when a text editor loses focus. */
  const endGroup = useCallback((): void => {
    activeGroupRef.current = null
    activeGroupAtRef.current = 0
  }, [])

  const steps = useWorkflowHistorySteps(
    { history: historyRef, activeGroup: activeGroupRef, activeGroupAt: activeGroupAtRef },
    onRestore,
    notify,
  )
  return {
    ...published,
    clear,
    record,
    beginTransaction,
    commitTransaction,
    endGroup,
    ...steps,
  }
}

/** Whether a repeat write to the same focused field should merge into its step. */
function coalesces(
  pastLength: number,
  activeGroup: MutableRefObject<string | null>,
  activeGroupAt: MutableRefObject<number>,
  group: string | undefined,
): boolean {
  if (
    pastLength === 0 ||
    group === undefined ||
    activeGroup.current !== group ||
    Date.now() - activeGroupAt.current > HISTORY_GROUP_WINDOW_MS
  ) {
    return false
  }
  return true
}

/**
 * The undo, redo and jump actions, plus the apply step they share.
 *
 * A plain function (not a callback) is enough here: the editor mounts these into
 * a new object every render anyway, so identities need not be stable. `jump`
 * just replays the step chain several times in one render so a history row can
 * restore directly.
 *
 * @param refs - The session refs the recorder updates.
 * @param onRestore - Hands the chosen snapshot to the draft.
 * @param notify - Publishes the resulting stacks and the new current event.
 */
function useWorkflowHistorySteps(
  refs: HistorySessionRefs,
  onRestore: (snapshot: WorkflowHistorySnapshot) => void,
  notify: (event: WorkflowHistoryEvent | null, meta: WorkflowHistoryMeta | undefined) => void,
) {
  /** Applies one state transition and hands the chosen snapshot to the editor. */
  function applyStep(nextState: WorkflowHistoryState, snapshot: WorkflowHistorySnapshot): boolean {
    refs.history.current = nextState
    refs.activeGroup.current = null
    refs.activeGroupAt.current = 0
    onRestore(snapshot)
    notify(nextState.past.at(-1)?.event ?? null, nextState.past.at(-1)?.meta)
    return true
  }

  /** Restores one or more previous steps and moves the current state into redo. */
  function move(
    direction: WorkflowHistoryDirection,
    steps: number,
    current: WorkflowHistorySnapshot,
  ): boolean {
    let nextState = refs.history.current
    let working = current
    let restored: WorkflowHistorySnapshot | null = null
    for (let index = 0; index < steps; index += 1) {
      const result =
        direction === 'past'
          ? undoWorkflowHistory(nextState, working)
          : redoWorkflowHistory(nextState, working)
      if (result.snapshot === null) {
        break
      }
      nextState = result.state
      restored = result.snapshot
      working = result.snapshot
    }
    if (restored === null) {
      return false
    }
    return applyStep(nextState, restored)
  }

  /** Restores one previous step, moving the current content into redo history. */
  function undo(current: WorkflowHistorySnapshot): boolean {
    return move('past', 1, current)
  }

  /** Restores one next step, moving the current content into undo history. */
  function redo(current: WorkflowHistorySnapshot): boolean {
    return move('future', 1, current)
  }

  /** Jumps several steps in one render so a history row can restore directly. */
  function jump(
    current: WorkflowHistorySnapshot,
    direction: WorkflowHistoryDirection,
    steps: number,
  ): boolean {
    return move(direction, steps, current)
  }

  return { undo, redo, jump }
}
