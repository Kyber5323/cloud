import { vi } from 'vitest'

/**
 * Stands in for a browser's layout pass in tests.
 *
 * jsdom lays nothing out, so every element measures zero. React Flow hides a
 * node whose measured box misses the viewport it knows, and reads geometry
 * straight off `getBoundingClientRect`, so an empty document keeps every card
 * `visibility: hidden` and every drop landing "outside" the canvas. One fixed
 * viewport-sized box gives the canvas the one measurement a browser would have
 * made. Call it from the test's `beforeEach`; the file's own
 * `vi.restoreAllMocks` in `afterEach` puts the real implementation back.
 */
export function stubViewportGeometry(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 1024,
    bottom: 768,
    width: 1024,
    height: 768,
    toJSON: () => ({}),
  })
}
