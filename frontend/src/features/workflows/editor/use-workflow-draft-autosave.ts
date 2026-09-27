import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'

/** Quiet period after the last edit before the draft is written. */
export const WORKFLOW_DRAFT_AUTOSAVE_MS = 1_000

/**
 * How many writes one flush may attempt before giving up.
 *
 * A write that keeps coming back `stale` means another editor is changing the
 * same workflow faster than this one can drain, so the flush reports failure
 * instead of spinning.
 */
const MAX_FLUSH_ATTEMPTS = 3

/** What the save indicator shows. */
export type WorkflowDraftSaveStatus = 'clean' | 'dirty' | 'saving' | 'error'

/** Outcome of one write attempt. */
export type WorkflowDraftSaveResult = 'saved' | 'stale' | 'skipped' | 'failed'

/** Options for {@link useWorkflowDraftAutosave}. */
export interface WorkflowDraftAutosaveOptions {
  /** When false, edits are ignored and any pending timer is cleared. */
  enabled: boolean
  /** Quiet period before a dirty draft is written. */
  debounceMs?: number
  /**
   * Persists the live draft. Must report whether the write still matches the
   * generation that started it, so an overlapping edit can reschedule.
   */
  save: () => Promise<WorkflowDraftSaveResult>
}

/** Controls and state returned by {@link useWorkflowDraftAutosave}. */
export interface WorkflowDraftAutosave {
  status: WorkflowDraftSaveStatus
  /** Records a persistable local edit and (re)starts the debounce timer. */
  markDirty: () => void
  /**
   * Cancels the timer and writes until the draft is clean or a write fails.
   *
   * @param options - Set `force` to write even when nothing was marked dirty,
   *   which is how a viewport-only change (pan or zoom) gets persisted.
   * @returns Whether the draft is clean afterwards.
   */
  flush: (options?: { force?: boolean }) => Promise<boolean>
  /** Drops pending dirty state without writing, e.g. after deleting the draft. */
  cancel: () => void
}

/**
 * The mutable state one autosave instance owns.
 *
 * The timers and the writer live in refs rather than in state because they are
 * read from callbacks that must see the current value without being recreated,
 * and because none of them should cause a render. They are bundled so the state
 * machine below can be written as plain functions instead of closures that
 * would have to be re-declared on every render.
 */
interface AutosaveRuntime {
  enabledRef: RefObject<boolean>
  saveRef: RefObject<() => Promise<WorkflowDraftSaveResult>>
  timerRef: RefObject<ReturnType<typeof setTimeout> | null>
  generationRef: RefObject<number>
  dirtyRef: RefObject<boolean>
  inFlightRef: RefObject<Promise<WorkflowDraftSaveResult> | null>
  runSaveRef: RefObject<() => Promise<WorkflowDraftSaveResult>>
  scheduleRef: RefObject<() => void>
  setStatus: (status: WorkflowDraftSaveStatus) => void
}

/**
 * Coalesces draft edits into debounced writes while serializing overlapping saves.
 *
 * The caller owns the persist call so it can read the latest canvas snapshot at
 * write time rather than at edit time. Dirty state deliberately survives a
 * temporary disable, and is written best-effort on unmount so a route change
 * does not drop edits still inside the debounce window.
 *
 * @param options - Whether saving is enabled, the quiet period, and the writer.
 * @returns The current status plus `markDirty`, `flush` and `cancel`.
 */
export function useWorkflowDraftAutosave({
  enabled,
  debounceMs = WORKFLOW_DRAFT_AUTOSAVE_MS,
  save,
}: WorkflowDraftAutosaveOptions): WorkflowDraftAutosave {
  const [status, setStatus] = useState<WorkflowDraftSaveStatus>('clean')
  const enabledRef = useRef(enabled)
  const saveRef = useRef(save)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generationRef = useRef(0)
  const dirtyRef = useRef(false)
  const inFlightRef = useRef<Promise<WorkflowDraftSaveResult> | null>(null)
  // Nothing is dirty before the first render publishes the real writer, so the
  // initial value reports "nothing to write" rather than needing a null check.
  const runSaveRef = useRef<() => Promise<WorkflowDraftSaveResult>>(async () => 'skipped')
  const scheduleRef = useRef<() => void>(() => undefined)

  const setSaveStatus = useCallback((next: WorkflowDraftSaveStatus) => {
    setStatus((current) => (current === next ? current : next))
  }, [])

  const runtime = useMemo<AutosaveRuntime>(
    () => ({
      enabledRef,
      saveRef,
      timerRef,
      generationRef,
      dirtyRef,
      inFlightRef,
      runSaveRef,
      scheduleRef,
      setStatus: setSaveStatus,
    }),
    // Every ref here is created by `useRef` and never replaced, so the runtime
    // is built once; only the setter can change identity, and it is stable too.
    [setSaveStatus],
  )

  const schedule = useCallback(() => {
    scheduleDraftSave(runtime, debounceMs)
  }, [debounceMs, runtime])

  const runSave = useCallback(() => runDraftSave(runtime), [runtime])

  const markDirty = useCallback(() => markDraftDirty(runtime, debounceMs), [debounceMs, runtime])

  const flush = useCallback(
    (options?: { force?: boolean }) => flushDraft(runtime, options),
    [runtime],
  )

  const cancel = useCallback(() => cancelDraft(runtime), [runtime])

  // Publish the latest closures after render so timers and unmount always see
  // the current values instead of the ones captured when they were created.
  useEffect(() => {
    publishDraftRuntime(runtime, { enabled, save, schedule, runSave })
  })

  // A disable (for example while previewing another version) keeps the draft
  // dirty and resumes the debounce as soon as editing is allowed again.
  useEffect(() => {
    if (!enabled) {
      clearDraftTimer(runtime)
      return
    }
    if (runtime.dirtyRef.current) {
      schedule()
    }
  }, [enabled, runtime, schedule])

  // Best-effort write on unmount so leaving the editor does not drop edits still
  // inside the debounce window. Closing the tab remains best-effort.
  useEffect(
    () => () => {
      clearDraftTimer(runtime)
      if (!runtime.dirtyRef.current) {
        return
      }
      // Swallow the rejection: an unmount must not leave an unhandled rejection
      // behind, which the test runner treats as a failure.
      void runtime.saveRef.current().catch(() => undefined)
    },
    [runtime],
  )

  return { status, markDirty, flush, cancel }
}

/** The latest closures and flags, republished after every render. */
interface PublishedDraftRuntime {
  enabled: boolean
  save: () => Promise<WorkflowDraftSaveResult>
  schedule: () => void
  runSave: () => Promise<WorkflowDraftSaveResult>
}

/** Points the runtime at the current props and the current closures. */
function publishDraftRuntime(runtime: AutosaveRuntime, published: PublishedDraftRuntime): void {
  runtime.enabledRef.current = published.enabled
  runtime.saveRef.current = published.save
  runtime.scheduleRef.current = published.schedule
  runtime.runSaveRef.current = published.runSave
}

/** Records a persistable local edit and (re)starts the debounce timer. */
function markDraftDirty(runtime: AutosaveRuntime, debounceMs: number): void {
  if (!runtime.enabledRef.current) {
    return
  }
  runtime.generationRef.current += 1
  runtime.dirtyRef.current = true
  // Status is set once per edit, not per drag frame: setStatus ignores a repeat
  // of the current value, so dragging does not re-render every frame.
  runtime.setStatus('dirty')
  scheduleDraftSave(runtime, debounceMs)
}

/** Drops pending dirty state without writing. */
function cancelDraft(runtime: AutosaveRuntime): void {
  clearDraftTimer(runtime)
  runtime.dirtyRef.current = false
  runtime.generationRef.current += 1
  runtime.setStatus('clean')
}

/** Drops the pending debounce timer, if any. */
function clearDraftTimer(runtime: AutosaveRuntime): void {
  if (runtime.timerRef.current !== null) {
    clearTimeout(runtime.timerRef.current)
    runtime.timerRef.current = null
  }
}

/** (Re)starts the debounce timer, unless there is nothing to write. */
function scheduleDraftSave(runtime: AutosaveRuntime, debounceMs: number): void {
  clearDraftTimer(runtime)
  if (!runtime.enabledRef.current || !runtime.dirtyRef.current) {
    return
  }
  runtime.timerRef.current = setTimeout(() => {
    runtime.timerRef.current = null
    void runtime.runSaveRef.current()
  }, debounceMs)
}

/** Writes once, joining an attempt already in flight rather than racing it. */
async function runDraftSave(runtime: AutosaveRuntime): Promise<WorkflowDraftSaveResult> {
  if (runtime.inFlightRef.current !== null) {
    // Join the in-flight write; that attempt already reschedules on stale.
    return runtime.inFlightRef.current
  }
  if (!runtime.dirtyRef.current || !runtime.enabledRef.current) {
    return 'skipped'
  }
  const startedGeneration = runtime.generationRef.current
  // Clear dirty only for this attempt: a skipped or failed write restores it,
  // so a no-op can never leave local edits marked clean.
  runtime.dirtyRef.current = false
  runtime.setStatus('saving')

  const attempt = settleDraftSave(runtime, startedGeneration)
  runtime.inFlightRef.current = attempt
  try {
    return await attempt
  } finally {
    if (runtime.inFlightRef.current === attempt) {
      runtime.inFlightRef.current = null
    }
  }
}

/** Records the outcome of one write, rescheduling when an edit overtook it. */
async function settleDraftSave(
  runtime: AutosaveRuntime,
  startedGeneration: number,
): Promise<WorkflowDraftSaveResult> {
  const result = await runtime.saveRef.current()
  if (result === 'failed') {
    runtime.dirtyRef.current = true
    runtime.setStatus('error')
    return result
  }
  if (result === 'skipped') {
    runtime.dirtyRef.current = true
    runtime.setStatus('dirty')
    return result
  }
  if (runtime.generationRef.current !== startedGeneration || result === 'stale') {
    runtime.dirtyRef.current = true
    runtime.setStatus('dirty')
    runtime.scheduleRef.current()
    return 'stale'
  }
  runtime.setStatus('clean')
  return 'saved'
}

/** Writes until the draft is clean, a write fails, or the attempts run out. */
async function drainDraft(runtime: AutosaveRuntime, attemptsLeft: number): Promise<boolean> {
  if (!runtime.enabledRef.current || !runtime.dirtyRef.current) {
    return !runtime.dirtyRef.current
  }
  if (attemptsLeft <= 0) {
    return false
  }
  clearDraftTimer(runtime)
  const result = await runDraftSave(runtime)
  if (result === 'failed' || result === 'skipped') {
    return false
  }
  return drainDraft(runtime, attemptsLeft - 1)
}

/** Cancels the timer and writes until the draft is clean or a write fails. */
async function flushDraft(
  runtime: AutosaveRuntime,
  options?: { force?: boolean },
): Promise<boolean> {
  clearDraftTimer(runtime)
  if (runtime.inFlightRef.current !== null) {
    await runtime.inFlightRef.current
  }
  // A manual save or a workflow switch must write even when only the viewport
  // changed, because pan and zoom never mark the draft dirty.
  if (options?.force === true && runtime.enabledRef.current) {
    runtime.dirtyRef.current = true
    runtime.generationRef.current += 1
  }
  return drainDraft(runtime, MAX_FLUSH_ATTEMPTS)
}
