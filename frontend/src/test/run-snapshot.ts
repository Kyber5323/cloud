/**
 * The frozen graph one run executed against, shared by every run-viewer test.
 *
 * A snapshot row stores the graph document exactly as the editor serializes it,
 * so the shape doubles as the run detail endpoint's `definitionSnapshot` and as
 * the direct prop the Overview canvas draws.
 */
export const RUN_SNAPSHOT: Record<string, unknown> = {
  nodes: [
    {
      id: 'start-1',
      type: 'workflow',
      position: { x: 0, y: 0 },
      data: { kind: 'start', title: '开始', description: '' },
    },
    {
      id: 'agent-1',
      type: 'workflow',
      position: { x: 240, y: 0 },
      data: { kind: 'agent', title: 'Agent 1', description: '' },
    },
  ],
  edges: [{ id: 'e-1', source: 'start-1', target: 'agent-1' }],
  viewport: { x: 0, y: 0, zoom: 1 },
}
