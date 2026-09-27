import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { initI18n } from '@/i18n/i18n-instance'
import { server } from './msw-server'

// The app entry initializes i18n before its first render; tests mount pages
// directly, so install it here or `useTranslation()` would render raw keys.
initI18n()

// Under a fully loaded parallel test run, two chained MSW requests plus a
// re-render can exceed the default 1000ms findBy timeout; raise it globally
// so timing-sensitive assertions never flake under load.
configure({ asyncUtilTimeout: 5000 })

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
})
afterAll(() => server.close())

// jsdom has no layout engine and doesn't implement matchMedia; the sidebar's
// mobile-breakpoint hook needs a stub so it doesn't throw on mount.
// jsdom also has no scrollIntoView implementation.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// ProseMirror maps pointer coordinates through document.elementFromPoint.
// jsdom leaves it undefined, which throws on mousedown and drops typed input.
if (typeof document.elementFromPoint !== 'function') {
  document.elementFromPoint = () => null
}
if (typeof document.caretRangeFromPoint !== 'function') {
  document.caretRangeFromPoint = () => null
}

// ProseMirror positions the caret through Range/Text node rects while focusing
// or measuring. jsdom implements neither getClientRects API, and coordsAtPos
// throws if they are missing.
const emptyClientRect = (): DOMRect => new DOMRect(0, 0, 0, 0)
const emptyClientRectList = (): DOMRectList => {
  // DOMRectList is a browser interface with no jsdom constructor; a literal
  // satisfying every member avoids an unsafe assertion.
  const list: DOMRectList = {
    item: () => emptyClientRect(),
    length: 0,
    *[Symbol.iterator](): Generator<DOMRect> {},
  }
  return list
}
if (typeof Range !== 'undefined') {
  if (typeof Range.prototype.getClientRects !== 'function') {
    Range.prototype.getClientRects = emptyClientRectList
  }
  if (typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = emptyClientRect
  }
}
if (typeof Text !== 'undefined') {
  const textProto = Text.prototype as Text & {
    getClientRects?: () => DOMRectList
  }
  if (typeof textProto.getClientRects !== 'function') {
    textProto.getClientRects = emptyClientRectList
  }
}

// base-ui's ScrollArea waits for subtree animations, then recomputes the thumb
// geometry — when scrollbars only react to layout changes. jsdom has no
// animation API, so it would throw on the first timeout. Empty is the correct
// answer: there are never any animations to wait for.
if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => []
}

if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

// jsdom has no ResizeObserver, and React Flow measures its container through
// one. Report the observed element's own box instead of nothing, so geometry
// code divides by a real size rather than zero (which yields NaN SVG coords).
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    private readonly callback: ResizeObserverCallback

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }

    observe(target: Element) {
      const bounds = target.getBoundingClientRect()
      const width = bounds.width || (target instanceof HTMLElement ? target.clientWidth : 0)
      const height = bounds.height || (target instanceof HTMLElement ? target.clientHeight : 0)
      this.callback(
        [
          {
            target,
            contentRect: {
              x: bounds.x,
              y: bounds.y,
              top: bounds.top,
              right: bounds.left + width,
              bottom: bounds.top + height,
              left: bounds.left,
              width,
              height,
              toJSON: () => ({}),
            },
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          },
        ],
        this,
      )
    }

    unobserve() {}
    disconnect() {}
  }
}

// React Flow reads the viewport's vertical scale while processing observed node
// dimensions. jsdom does not provide DOMMatrixReadOnly.
if (!window.DOMMatrixReadOnly) {
  Object.defineProperty(window, 'DOMMatrixReadOnly', {
    configurable: true,
    value: class {
      readonly m22: number

      constructor(transform = '') {
        const scale = /scale\(([^)]+)\)/u.exec(transform)?.[1]
        this.m22 = scale === undefined ? 1 : Number(scale)
      }
    },
  })
}
