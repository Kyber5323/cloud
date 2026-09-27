import { AlignLeft, Braces, File, Files, Hash, List, SquareCheck, Type } from 'lucide-react'
import type { WorkflowInputFieldType } from '@/features/workflows/runtime/types'

/**
 * Gives each Start form control a stable visual identity in lists and selectors.
 *
 * The icons are presentation only — nothing keys off them — but keeping the
 * mapping here means the row list and the type picker cannot diverge.
 */
export function StartFieldTypeIcon({
  fieldType,
  className,
}: {
  fieldType: WorkflowInputFieldType
  className?: string
}) {
  switch (fieldType) {
    case 'text-input':
      return <Type className={className} />
    case 'paragraph':
      return <AlignLeft className={className} />
    case 'select':
      return <List className={className} />
    case 'number':
      return <Hash className={className} />
    case 'checkbox':
      return <SquareCheck className={className} />
    case 'file':
      return <File className={className} />
    case 'file-list':
      return <Files className={className} />
    case 'json':
      return <Braces className={className} />
    default:
      return null
  }
}
