import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WORKFLOW_DRAFT_AUTOSAVE_MS,
  useWorkflowDraftAutosave,
  type WorkflowDraftSaveResult,
} from '@/features/workflows/editor/use-workflow-draft-autosave'

/** Quiet period the tests configure, so a debounce is two advances at most. */
const DEBOUNCE_MS = 50

/** A writer that resolves `result` on every call, recording how often it ran. */
function writer(result: WorkflowDraftSaveResult = 'saved') {
  return vi.fn<() => Promise<WorkflowDraftSaveResult>>().mockResolvedValue(result)
}

/** A writer whose first call stays in flight until the test releases it. */
function blockingWriter(later: WorkflowDraftSaveResult = 'saved') {
  let settle: ((result: WorkflowDraftSaveResult) => void) | undefined
  const gate = new Promise<WorkflowDraftSaveResult>((resolve) => {
    settle = resolve
  })
  let callCount = 0
  const save = vi.fn<() => Promise<WorkflowDraftSaveResult>>(async () => {
    callCount += 1
    return callCount === 1 ? gate : later
  })
  return {
    save,
    release: (result: WorkflowDraftSaveResult): void => settle?.(result),
    calls: (): number => callCount,
  }
}

/** Mounts the hook with the test's quiet period. */
function setup(
  save: () => Promise<WorkflowDraftSaveResult>,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return renderHook(
    (props: { enabled: boolean }) =>
      useWorkflowDraftAutosave({ ...props, debounceMs: DEBOUNCE_MS, save }),
    { initialProps: { enabled } },
  )
}

/** Lets the debounce timer and every promise it starts run to completion. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

describe('useWorkflowDraftAutosave', () => {
  it('starts clean and writes nothing on its own', async () => {
    const save = writer()
    const { result } = setup(save)

    await advance(DEBOUNCE_MS * 4)

    expect(result.current.status).toBe('clean')
    expect(save).not.toHaveBeenCalled()
  })

  it('writes once the quiet period has elapsed', async () => {
    const save = writer()
    const { result } = setup(save)

    act(() => {
      result.current.markDirty()
    })

    expect(result.current.status).toBe('dirty')
    expect(save).not.toHaveBeenCalled()

    await advance(DEBOUNCE_MS)

    expect(save).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('clean')
  })

  it('waits the published quiet period when none is configured', async () => {
    const save = writer()
    const { result } = renderHook(() => useWorkflowDraftAutosave({ enabled: true, save }))

    act(() => {
      result.current.markDirty()
    })
    await advance(WORKFLOW_DRAFT_AUTOSAVE_MS - 1)

    expect(save).not.toHaveBeenCalled()

    await advance(1)

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('coalesces a burst of edits into one write', async () => {
    const save = writer()
    const { result } = setup(save)

    act(() => {
      result.current.markDirty()
    })
    await advance(DEBOUNCE_MS / 2)
    act(() => {
      result.current.markDirty()
    })
    await advance(DEBOUNCE_MS / 2)

    expect(save).not.toHaveBeenCalled()

    await advance(DEBOUNCE_MS / 2)

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flushes without waiting out the debounce', async () => {
    const save = writer()
    const { result } = setup(save)

    act(() => {
      result.current.markDirty()
    })
    let cleaned: boolean | undefined
    await act(async () => {
      cleaned = await result.current.flush()
    })

    expect(save).toHaveBeenCalledTimes(1)
    expect(cleaned).toBe(true)
    expect(result.current.status).toBe('clean')
  })

  it('does not write a flush of a draft nothing has changed', async () => {
    const save = writer()
    const { result } = setup(save)

    let cleaned: boolean | undefined
    await act(async () => {
      cleaned = await result.current.flush()
    })

    expect(save).not.toHaveBeenCalled()
    expect(cleaned).toBe(true)
  })

  it('writes a forced flush of a draft nothing has marked dirty', async () => {
    const save = writer()
    const { result } = setup(save)

    await act(async () => {
      await result.current.flush({ force: true })
    })

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('keeps the draft dirty when a write fails, so a later flush retries', async () => {
    const save = writer()
    save.mockResolvedValueOnce('failed')
    const { result } = setup(save)

    act(() => {
      result.current.markDirty()
    })
    await advance(DEBOUNCE_MS)

    expect(result.current.status).toBe('error')

    let cleaned: boolean | undefined
    await act(async () => {
      cleaned = await result.current.flush()
    })

    expect(save).toHaveBeenCalledTimes(2)
    expect(cleaned).toBe(true)
    expect(result.current.status).toBe('clean')
  })

  it('reschedules a stale write instead of dropping the edit', async () => {
    const save = writer()
    save.mockResolvedValueOnce('stale')
    const { result } = setup(save)

    act(() => {
      result.current.markDirty()
    })
    await advance(DEBOUNCE_MS)

    expect(save).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('dirty')

    await advance(DEBOUNCE_MS)

    expect(save).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('clean')
  })

  it('gives up on a draft that keeps coming back stale', async () => {
    const save = writer('stale')
    const { result } = setup(save)

    act(() => {
      result.current.markDirty()
    })
    let cleaned: boolean | undefined
    await act(async () => {
      cleaned = await result.current.flush()
    })

    expect(cleaned).toBe(false)
    expect(save).toHaveBeenCalledTimes(3)
  })

  it('reports the draft as saving while a write is in flight', async () => {
    const { save, release } = blockingWriter()
    const { result } = setup(save)

    act(() => {
      result.current.markDirty()
    })
    await advance(DEBOUNCE_MS)

    expect(result.current.status).toBe('saving')

    await act(async () => {
      release('saved')
    })

    expect(result.current.status).toBe('clean')
  })

  it('keeps an edit that arrives while a write is in flight', async () => {
    const { save, release, calls } = blockingWriter()
    const { result } = setup(save)

    act(() => {
      result.current.markDirty()
    })
    await advance(DEBOUNCE_MS)
    act(() => {
      result.current.markDirty()
    })
    await act(async () => {
      release('saved')
    })

    // The write that just landed predates the second edit, so it is not clean.
    expect(result.current.status).toBe('dirty')

    await advance(DEBOUNCE_MS)

    expect(calls()).toBe(2)
    expect(result.current.status).toBe('clean')
  })

  it('joins a write already in flight rather than racing it', async () => {
    const { save, release, calls } = blockingWriter()
    const { result } = setup(save)

    act(() => {
      result.current.markDirty()
    })
    await act(async () => {
      const first = result.current.flush()
      const second = result.current.flush()
      release('saved')
      await Promise.all([first, second])
    })

    expect(calls()).toBe(1)
    expect(result.current.status).toBe('clean')
  })

  it('ignores edits while saving is disabled', async () => {
    const save = writer()
    const { result } = setup(save, { enabled: false })

    act(() => {
      result.current.markDirty()
    })
    await advance(DEBOUNCE_MS * 2)

    expect(save).not.toHaveBeenCalled()
    expect(result.current.status).toBe('clean')
  })

  it('keeps a pending edit across a disable and writes it once re-enabled', async () => {
    const save = writer()
    const { result, rerender } = setup(save)

    act(() => {
      result.current.markDirty()
    })
    rerender({ enabled: false })
    await advance(DEBOUNCE_MS * 2)

    expect(save).not.toHaveBeenCalled()

    rerender({ enabled: true })
    await advance(DEBOUNCE_MS)

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('drops a pending edit on cancel without writing it', async () => {
    const save = writer()
    const { result } = setup(save)

    act(() => {
      result.current.markDirty()
    })
    act(() => {
      result.current.cancel()
    })
    await advance(DEBOUNCE_MS * 2)

    expect(save).not.toHaveBeenCalled()
    expect(result.current.status).toBe('clean')
  })

  it('writes a draft still inside the debounce window when it unmounts', async () => {
    const save = writer()
    const { result, unmount } = setup(save)

    act(() => {
      result.current.markDirty()
    })
    unmount()

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('writes nothing on unmount when the draft is clean', () => {
    const save = writer()
    const { unmount } = setup(save)

    unmount()

    expect(save).not.toHaveBeenCalled()
  })
})
