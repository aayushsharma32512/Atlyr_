/**
 * Read every row a PostgREST query matches, not just the first page.
 *
 * PostgREST caps a single response at `max-rows` (1000 on Supabase) and says nothing when it
 * truncates — the caller gets 1000 rows and no error, so a screen looks correct right up until
 * the table outgrows the cap and then quietly stops showing the tail. The products table passed
 * 1000 on 2026-09-13 and the placement dashboard began hiding 444 products.
 *
 * Pure — no Supabase types, no React — so the paging rule is testable on its own. The ingestion
 * service carries its own copy (services/ingestion-automated/src/utils/paged-fetch.ts): the two
 * are separate packages, and a shared workspace package would cost more than these few lines.
 */

/** PostgREST's default response cap. A full page means "there may be more". */
export const POSTGREST_PAGE_SIZE = 1000

export interface PageAllOptions {
  /** Rows per request. Must not exceed the server's max-rows or a full page can't be detected. */
  pageSize?: number
  /** Safety valve: refuse to loop forever if the server keeps answering with full pages. */
  maxPages?: number
}

/**
 * `fetchPage(from, to)` takes an inclusive range, matching `.range(from, to)`.
 *
 * Stops on the first short page — the only signal PostgREST gives that the result is exhausted,
 * since an exact count costs an extra round trip. Errors propagate: a failed page must not look
 * like the end of the data.
 */
export async function pageAll<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  opts: PageAllOptions = {},
): Promise<T[]> {
  const pageSize = Math.max(1, opts.pageSize ?? POSTGREST_PAGE_SIZE)
  const maxPages = Math.max(1, opts.maxPages ?? 1000)

  const rows: T[] = []
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize
    const batch = await fetchPage(from, from + pageSize - 1)
    rows.push(...batch)
    if (batch.length < pageSize) break
  }
  return rows
}
