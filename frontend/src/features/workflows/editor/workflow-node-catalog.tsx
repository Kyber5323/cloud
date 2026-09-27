import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { workflowNodeTypeDefinition } from '@/features/workflows/runtime/node-catalog'
import { AUTHORABLE_NODE_KINDS } from '@/features/workflows/runtime/node-factory'
import type { WorkflowNodeKind, WorkflowPosition } from '@/features/workflows/runtime/types'
import { useWorkflowTranslator } from '@/features/workflows/editor/use-workflow-translator'
import { workflowNodeMetadata } from '@/features/workflows/editor/node-metadata'

/** How far the track may be dragged past its end, in pixels. */
const MAX_ELASTIC_OFFSET = 18

/** Fraction of the overscrolled distance that becomes elastic travel. */
const ELASTIC_RESISTANCE = 0.14

/** Idle time after the last wheel event before the track springs back. */
const WHEEL_END_DELAY_MS = 100

/** Pointer travel that turns a press into a drag rather than a click. */
const NODE_DRAG_THRESHOLD = 4

/** Pixels one line-mode wheel notch scrolls. */
const WHEEL_LINE_HEIGHT = 16

/** One in-flight catalog drag. */
interface NodeDragDraft {
  kind: WorkflowNodeKind
  pointerId: number
  origin: WorkflowPosition
  moved: boolean
}

/** The capsule that follows the pointer during a catalog drag. */
interface NodeDragPreview {
  kind: WorkflowNodeKind
  position: WorkflowPosition
}

/** Per-entry pointer handlers, shared by every entry in the dock. */
interface CatalogEntryHandlers {
  onClick: (event: ReactMouseEvent<HTMLButtonElement>, kind: WorkflowNodeKind) => void
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, kind: WorkflowNodeKind) => void
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
}

/** Props for {@link WorkflowNodeCatalog}. */
export interface WorkflowNodeCatalogProps {
  /** Whether the canvas already has its required Start node. */
  hasStartNode: boolean
  /** Adds a node at the centre of the visible canvas. */
  onAdd: (kind: WorkflowNodeKind) => void
  /** Adds a node where a drag was released, in client coordinates. */
  onDrop: (kind: WorkflowNodeKind, position: WorkflowPosition) => void
}

/**
 * The node dock along the bottom of the canvas.
 *
 * Every entry can be clicked to land in the middle of the visible canvas, or
 * dragged onto a specific spot. The drag uses pointer capture rather than HTML
 * drag-and-drop so the same code runs in a browser and in a desktop WebView,
 * where native drag events are unavailable.
 *
 * @param props - Whether a start node already exists, and the two add callbacks.
 */
export function WorkflowNodeCatalog({ hasStartNode, onAdd, onDrop }: WorkflowNodeCatalogProps) {
  const { t } = useTranslation()
  const viewportRef = useRef<HTMLDivElement>(null)
  const track = useElasticTrack(viewportRef)
  const drag = useCatalogDrag(onAdd, onDrop)

  return (
    <div
      role="toolbar"
      aria-orientation="horizontal"
      aria-label={t('workflows.palette.addNode')}
      onWheel={track.onWheel}
      className="flex w-max max-w-full items-center gap-1 rounded-xl border border-border bg-background/95 p-1 shadow-lg backdrop-blur"
    >
      <div className="hidden shrink-0 items-center gap-1.5 border-r border-border px-2 xl:flex">
        <SlidersHorizontal className="size-3.5 text-muted-foreground" />
        <span className="text-[10px] font-semibold">{t('workflows.palette.title')}</span>
      </div>
      <div
        ref={viewportRef}
        className="min-w-0 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className={track.trackClassName} style={track.trackStyle}>
          {AUTHORABLE_NODE_KINDS.map((kind) => (
            <CatalogEntry
              key={kind}
              kind={kind}
              disabled={kind === 'start' && hasStartNode}
              handlers={drag.handlers}
            />
          ))}
        </div>
      </div>
      {drag.preview !== null && createPortal(<NodeDragCapsule {...drag.preview} />, document.body)}
    </div>
  )
}

/**
 * Horizontal wheel scrolling for the dock, with rubber-band overshoot.
 *
 * The dock is the only scrollable thing under the pointer, so a wheel notch is
 * spent here rather than panning the canvas behind it. Past either end the track
 * follows the wheel a little and springs back once the wheel goes quiet, which
 * is what tells a user the list has ended.
 *
 * @param viewportRef - The scroll container the caller attaches to its own node.
 * @returns The wheel handler plus the class and transform for the inner track.
 */
function useElasticTrack(viewportRef: RefObject<HTMLDivElement | null>): {
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void
  trackClassName: string
  trackStyle: CSSProperties
} {
  const returnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const offsetRef = useRef(0)
  const [offset, setOffset] = useState(0)
  const [returning, setReturning] = useState(false)

  useEffect(
    () => () => {
      if (returnTimerRef.current !== null) {
        clearTimeout(returnTimerRef.current)
      }
    },
    [],
  )

  /** Records how far past the end the track was pulled and schedules its return. */
  const applyElasticOffset = useCallback((overflow: number) => {
    if (returnTimerRef.current !== null) {
      clearTimeout(returnTimerRef.current)
    }
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const next = reduceMotion ? 0 : clampElastic(offsetRef.current - overflow * ELASTIC_RESISTANCE)
    offsetRef.current = next
    setReturning(false)
    setOffset(next)
    returnTimerRef.current = setTimeout(() => {
      offsetRef.current = 0
      setReturning(true)
      setOffset(0)
    }, WHEEL_END_DELAY_MS)
  }, [])

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current
      if (viewport === null) {
        return
      }
      event.stopPropagation()
      event.preventDefault()
      const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
      const requested = viewport.scrollLeft + wheelScrollDistance(event, viewport.clientWidth)
      const next = Math.min(maxScrollLeft, Math.max(0, requested))
      viewport.scrollLeft = next
      applyElasticOffset(requested - next)
    },
    [applyElasticOffset, viewportRef],
  )

  return {
    onWheel,
    trackClassName: cn(
      'flex w-max items-center gap-0.5 px-0.5',
      returning && 'transition-transform duration-200 ease-out motion-reduce:transition-none',
    ),
    trackStyle: { transform: `translate3d(${offset}px, 0, 0)` },
  }
}

/**
 * Turns a press on a palette entry into either a click or a drag.
 *
 * The gesture is decided by how far the pointer travelled, not by the browser's
 * drag events: a press that never moves stays a click, and the click the browser
 * emits after a real drag is suppressed so the node is not added twice.
 *
 * @param onAdd - Adds a node at the centre of the visible canvas.
 * @param onDrop - Adds a node where a drag was released, in client coordinates.
 * @returns The shared entry handlers and the capsule to draw mid-drag.
 */
function useCatalogDrag(
  onAdd: (kind: WorkflowNodeKind) => void,
  onDrop: (kind: WorkflowNodeKind, position: WorkflowPosition) => void,
): { handlers: CatalogEntryHandlers; preview: NodeDragPreview | null } {
  const dragRef = useRef<NodeDragDraft | null>(null)
  const suppressClickRef = useRef(false)
  const [preview, setPreview] = useState<NodeDragPreview | null>(null)

  const handlers = useMemo<CatalogEntryHandlers>(() => {
    /** Starts a press that may become a drag. */
    function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, kind: WorkflowNodeKind) {
      if (event.button !== 0 || !event.isPrimary) {
        return
      }
      suppressClickRef.current = false
      setPreview(null)
      dragRef.current = {
        kind,
        pointerId: event.pointerId,
        origin: { x: event.clientX, y: event.clientY },
        moved: false,
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }

    /** Promotes the press to a drag once the pointer clears the click threshold. */
    function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
      const draft = dragRef.current
      if (draft === null || draft.pointerId !== event.pointerId) {
        return
      }
      if (!draft.moved && pointerTravel(draft, event) < NODE_DRAG_THRESHOLD) {
        return
      }
      draft.moved = true
      setPreview({ kind: draft.kind, position: { x: event.clientX, y: event.clientY } })
    }

    /** Drops a dragged node and suppresses the click the browser emits afterwards. */
    function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
      const draft = dragRef.current
      if (draft === null || draft.pointerId !== event.pointerId) {
        return
      }
      dragRef.current = null
      setPreview(null)
      if (!draft.moved && pointerTravel(draft, event) < NODE_DRAG_THRESHOLD) {
        return
      }
      suppressClickRef.current = true
      event.preventDefault()
      onDrop(draft.kind, { x: event.clientX, y: event.clientY })
    }

    /** Clears an interrupted gesture so the next click stays independent. */
    function onPointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
      if (dragRef.current?.pointerId === event.pointerId) {
        dragRef.current = null
        setPreview(null)
      }
    }

    /** Adds on click, unless that click is the tail of a drag. */
    function onClick(event: ReactMouseEvent<HTMLButtonElement>, kind: WorkflowNodeKind) {
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        event.preventDefault()
        return
      }
      onAdd(kind)
    }

    return { onClick, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
  }, [onAdd, onDrop])

  return { handlers, preview }
}

/** One clickable and draggable palette entry. */
function CatalogEntry({
  kind,
  disabled,
  handlers,
}: {
  kind: WorkflowNodeKind
  disabled: boolean
  handlers: CatalogEntryHandlers
}) {
  const { t } = useTranslation()
  const translate = useWorkflowTranslator()
  const metadata = workflowNodeMetadata(kind)
  const Icon = metadata.icon
  const label = translate(workflowNodeTypeDefinition(kind).labelKey)
  return (
    <button
      type="button"
      disabled={disabled}
      title={
        disabled ? t('workflows.palette.startAlreadyPresent') : t('workflows.palette.dragHint')
      }
      onClick={(event) => handlers.onClick(event, kind)}
      onPointerDown={(event) => handlers.onPointerDown(event, kind)}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
      onLostPointerCapture={handlers.onPointerCancel}
      className="group flex h-9 shrink-0 touch-none cursor-grab items-center gap-1 rounded-lg border border-transparent px-1.5 text-left outline-none transition-colors hover:border-border hover:bg-muted/65 focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-transparent disabled:hover:bg-transparent"
    >
      <span
        className={cn('flex size-6 shrink-0 items-center justify-center rounded-md', metadata.tone)}
      >
        <Icon className="size-3.5" strokeWidth={1.8} />
      </span>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  )
}

/** The capsule that follows the pointer while a palette entry is dragged. */
function NodeDragCapsule({ kind, position }: NodeDragPreview) {
  const translate = useWorkflowTranslator()
  const metadata = workflowNodeMetadata(kind)
  const Icon = metadata.icon
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-[100] flex h-10 items-center gap-1.5 rounded-full border border-foreground/20 bg-background/95 px-2 shadow-lg backdrop-blur-sm"
      style={{ left: position.x, top: position.y, transform: 'translate(-50%, -50%)' }}
    >
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full',
          metadata.tone,
        )}
      >
        <Icon className="size-3.5" strokeWidth={1.8} />
      </span>
      <span className="pr-1 text-[10px] font-medium">
        {translate(workflowNodeTypeDefinition(kind).labelKey)}
      </span>
    </div>
  )
}

/** Converts one wheel event into a horizontal scroll distance. */
function wheelScrollDistance(
  event: ReactWheelEvent<HTMLDivElement>,
  viewportWidth: number,
): number {
  const dominant = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return dominant * WHEEL_LINE_HEIGHT
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return dominant * viewportWidth
  }
  return dominant
}

/** Keeps the elastic travel within its bound. */
function clampElastic(offset: number): number {
  return Math.min(MAX_ELASTIC_OFFSET, Math.max(-MAX_ELASTIC_OFFSET, offset))
}

/** Straight-line distance the pointer has travelled since the press. */
function pointerTravel(draft: NodeDragDraft, event: ReactPointerEvent<HTMLButtonElement>): number {
  return Math.hypot(event.clientX - draft.origin.x, event.clientY - draft.origin.y)
}
