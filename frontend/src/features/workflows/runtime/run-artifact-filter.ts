import type { WorkflowArtifact } from '@/features/workflows/runtime/types'

/** Filter mode: all run artifacts or one node's outputs. */
export type ArtifactFilterMode = { type: 'all' } | { type: 'node'; nodeId: string }

/**
 * Returns artifacts for a scope, newest first.
 *
 * A node filter keeps only that node's outputs; an empty scope still yields `[]`.
 *
 * @param artifacts - The run's artifacts.
 * @param mode - Whole-run or per-node scope.
 * @returns Matching artifacts, newest `createdAt` first.
 */
export function filterArtifacts(
  artifacts: readonly WorkflowArtifact[],
  mode: ArtifactFilterMode,
): WorkflowArtifact[] {
  const scoped = [...artifacts].filter((item) => mode.type === 'all' || item.nodeId === mode.nodeId)
  return scoped.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Newest artifact by createdAt, or null when the list is empty. */
export function latestArtifact(artifacts: readonly WorkflowArtifact[]): WorkflowArtifact | null {
  if (artifacts.length === 0) {
    return null
  }
  return filterArtifacts(artifacts, { type: 'all' })[0] ?? null
}
