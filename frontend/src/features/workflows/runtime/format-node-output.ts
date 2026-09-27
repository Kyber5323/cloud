/**
 * Pretty-prints a node output value for the inspector, preserving plain text verbatim.
 *
 * The simulator writes structured JSON objects (and inline text); output that is not JSON
 * at all is shown exactly as stored. A JSON string result renders as the string itself, not
 * wrapped in quotes.
 *
 * @param output - Raw stored node output, or `undefined` when the node never produced one.
 * @returns The formatted text.
 */
export function formatNodeOutput(output: unknown): string {
  if (output === undefined) {
    return ''
  }
  if (typeof output === 'string') {
    return output
  }
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    // Circular references or BigInts defeat JSON entirely; a marker is more honest
    // than JavaScript's lossy `[object Object]` fallback.
    return '[unserializable value]'
  }
}
