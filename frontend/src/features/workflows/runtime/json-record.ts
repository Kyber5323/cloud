/**
 * Narrows JSON-like values to non-array objects.
 *
 * `Object.entries` rebuilds a real `Record` without an `as` cast, which is how this codebase
 * narrows untyped JSON: a type assertion on a value that came out of `JSON.parse` is rejected by
 * the lint gate, and rightly so — it asserts a shape nothing has checked.
 */
export function asJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value))
  }
  return undefined
}

/** Boolean form of {@link asJsonRecord}, for guards that only need the answer. */
export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return asJsonRecord(value) !== undefined
}
