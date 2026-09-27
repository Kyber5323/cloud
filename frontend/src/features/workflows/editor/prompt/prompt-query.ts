/**
 * Matches a slash token anywhere before the caret for inline variable
 * insertion. Intentionally lenient: unlike command mode there is no lookbehind
 * for a line start or space, so `a/b` starts a query too. A slash followed by
 * whitespace or another slash does not start one (the token is empty, so the
 * character class cannot consume past the slash).
 */
export const INLINE_SLASH_TRIGGER_PATTERN = /\/([^\s/]*)$/

/** Slash token edits a variable name; a blank caret without `/` opens nothing. */
export const EMPTY_PROMPT_QUERY = null

/**
 * The namespace the caret is typing right after a `/`, or `null` when it is
 * not inside one. Inline mode is lenient — `a/b` qualifies (`b` is the query)
 * and a doubled slash just starts from the latest one (`//x` queries `x`).
 * The only null cases are a bare `/` followed by whitespace with text after it
 * (`1 / 2`), because the token class cannot consume the space to reach `$`.
 */
export function promptSlashQueryFromText(textBeforeCursor: string): string | null {
  const match = textBeforeCursor.match(INLINE_SLASH_TRIGGER_PATTERN)
  return match?.[1] ?? null
}

/** Whether two query states are the same, so the editor skips re-renders. */
export function promptQueryStatusesEqual(left: string | null, right: string | null): boolean {
  return left === right
}
