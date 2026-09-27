import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The kind-icon + title + id-chip + description block every workflow card leads
 * with.
 *
 * The editable canvas card and the read-only run Overview card both open a node
 * with this identity chrome; keeping it in one place means the two surfaces
 * cannot silently drift apart. The trailing `action` slot is where the editor
 * puts its delete control and the overview its status badge.
 */
export function NodeIdentity({
  id,
  title,
  description,
  kindLabel,
  tone,
  icon: Icon,
  action,
}: {
  id: string
  title: string
  description: string
  kindLabel: string
  /** The tailwind classes tinting the kind icon's tile. */
  tone: string
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
  action?: ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5 px-3 py-3">
      <span
        title={kindLabel}
        className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', tone)}
      >
        <Icon className="size-4" strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <h4 className="min-w-0 truncate font-sans text-sm font-bold">{title}</h4>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
            {id}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  )
}
