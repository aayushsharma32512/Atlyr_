/**
 * Which list the rack shows, in the order it arrived.
 *
 * The rack used to sort by price and splice the worn piece to the front, so the
 * order a search returned was never the order shown. Both are gone: the worn
 * piece is marked in place instead.
 */
export function selectRackProducts<T>(opts: {
  searchResults: T[] | undefined
  fallback: T[] | undefined
  /** True once a search is committed, or on cold start / admin. */
  useSearchResults: boolean
}): T[] {
  const { searchResults, fallback, useSearchResults } = opts
  if (useSearchResults && searchResults) {
    return searchResults
  }
  return fallback ?? []
}
