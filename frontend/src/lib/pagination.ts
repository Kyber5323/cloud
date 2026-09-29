/** Walks every bounded API page so roster and approval views cannot silently omit later rows. */
export async function readAllPages<T>(
  readPage: (after: string | undefined) => Promise<{ items: T[]; nextCursor: string }>,
): Promise<{ items: T[]; nextCursor: string }> {
  const items: T[] = []
  let after: string | undefined
  do {
    // Each request needs the cursor produced by the preceding page.
    // oxlint-disable-next-line no-await-in-loop -- the next cursor is not known earlier.
    const page = await readPage(after)
    items.push(...page.items)
    after = page.nextCursor || undefined
  } while (after)
  return { items, nextCursor: '' }
}
