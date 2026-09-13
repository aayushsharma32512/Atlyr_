/**
 * Read every row a PostgREST query matches, not just the first page.
 *
 * PostgREST caps a single response at `max-rows` (1000 on Supabase) and says nothing when it
 * truncates — the caller just gets 1000 rows and no error. `listJobs` asked for `limit(1000)` and
 * looked correct for months; the queue passed 1000 on 2026-09-13 and the dashboard quietly stopped
 * showing 432 jobs. The frontend's artifact fetcher already pages for exactly this reason; this is
 * the same rule for the service.
 *
 * Pure — no config, no network, no Supabase types — so the paging logic is testable on its own.
 */

/** PostgREST's default response cap. A full page means "there may be more". */
export const POSTGREST_PAGE_SIZE = 1000;

export interface PagedFetchOptions {
  /** Rows per request. Must not exceed the server's max-rows or the loop cannot detect a full page. */
  pageSize?: number;
  /** Stop after this many rows. Omit for "everything". */
  limit?: number;
  /** Start offset, for callers that page themselves. */
  offset?: number;
  /** Safety valve: refuse to loop forever if the server keeps returning full pages. */
  maxPages?: number;
}

/**
 * `fetchPage(from, to)` is an inclusive PostgREST range, matching `.range(from, to)`.
 *
 * Stops on the first short page — that is the only signal PostgREST gives that the result is
 * exhausted, since a `count` costs an extra round trip and is not needed here.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  opts: PagedFetchOptions = {},
): Promise<T[]> {
  const pageSize = Math.max(1, opts.pageSize ?? POSTGREST_PAGE_SIZE);
  const maxPages = Math.max(1, opts.maxPages ?? 1000);
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = opts.limit;

  const rows: T[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    // Never ask for more than the caller wants: the last page is trimmed to the remaining need,
    // so `limit: 1500` costs two requests (1000 + 500) rather than two full pages.
    const remaining = limit === undefined ? pageSize : Math.min(pageSize, limit - rows.length);
    if (remaining <= 0) break;

    const from = offset + rows.length;
    const batch = await fetchPage(from, from + remaining - 1);
    rows.push(...batch);

    // A short page is the end of the data. Asking again would only return nothing.
    if (batch.length < remaining) break;
  }

  return limit === undefined ? rows : rows.slice(0, limit);
}
