'use client'

import {
  Group,
  Panel,
  Separator,
  type GroupProps,
  type PanelImperativeHandle,
  type PanelProps,
  type SeparatorProps,
} from 'react-resizable-panels'
import { cn } from 'cn'

/** Imperative handle a panel exposes, e.g. to collapse the inspector. */
export type ResizablePanelHandle = PanelImperativeHandle

/**
 * Two or more panels that share their space along one axis.
 *
 * The primitive sets `display`, `flex-direction`, `height` and `width` as inline
 * styles, so the classes here only carry what a caller passes in.
 */
function ResizablePanelGroup({ className, ...props }: GroupProps) {
  return (
    <Group
      data-slot="resizable-panel-group"
      className={cn('flex h-full w-full', className)}
      {...props}
    />
  )
}

/** One region of a {@link ResizablePanelGroup}. */
function ResizablePanel({ className, style, ...props }: PanelProps) {
  return (
    <Panel
      data-slot="resizable-panel"
      // The primitive gives the panel body `max-height: 100%` and `overflow: auto`
      // but no definite height, so a child sized with `h-full` has no percentage
      // basis to resolve against and grows to its content instead — at which point
      // the panel itself scrolls and drags the pane past the window. Making the
      // body a flex column lets children size with `flex-1` + `min-h-0`, and
      // clipping here keeps scrolling inside the regions that opt into it.
      className={cn('flex min-h-0 min-w-0 flex-col', className)}
      style={{ overflow: 'hidden', ...style }}
      {...props}
    />
  )
}

/** The draggable divider between two panels. */
function ResizableHandle({
  withHandle,
  className,
  ...props
}: SeparatorProps & {
  /** Draws a visible grip, for a divider that is not obvious from the layout. */
  withHandle?: boolean
}) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        'relative flex w-px items-center justify-center bg-border ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90',
        className,
      )}
      {...props}
    >
      {withHandle && <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />}
    </Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
