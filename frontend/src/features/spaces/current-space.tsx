import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { SpaceListItem } from '@/api/generated.schemas'
import { useJoinedSpaces } from '@/features/spaces/api'

/**
 * Current-space context: resolves the route's `:workspaceSlug` against the
 * spaces the signed-in member joined and exposes the selected space's tenant id every
 * tenant-scoped API needs. Pages read {@link useCurrentSpace} instead of
 * touching routing or the tenant list themselves.
 */
export interface CurrentSpaceValue {
  /** Tenant id of the space selected by the route slug. */
  tenantId: string | undefined
  /** Spaces the signed-in member joined; `[]` once resolved for a member with none. */
  spaces: SpaceListItem[] | undefined
  /** The space matching the active route slug, when one exists. */
  space: SpaceListItem | undefined
  /** True until the tenant and space lists have settled. */
  isPending: boolean
  /** True when either list failed for a reason other than being signed out. */
  isError: boolean
}

const CurrentSpaceContext = createContext<CurrentSpaceValue | null>(null)

export function CurrentSpaceProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const { spaces, isPending, isError } = useJoinedSpaces()
  const space = spaces?.find((candidate) => candidate.slug === slug)
  const tenantId = space?.tenantId
  const value = useMemo(
    () => ({ tenantId, spaces, space, isPending, isError }),
    [tenantId, spaces, space, isPending, isError],
  )
  return <CurrentSpaceContext.Provider value={value}>{children}</CurrentSpaceContext.Provider>
}

export function useCurrentSpace(): CurrentSpaceValue {
  const value = useContext(CurrentSpaceContext)
  if (!value) throw new Error('useCurrentSpace must be used within a CurrentSpaceProvider')
  return value
}
