/** Board detail lives under Collections. `/home` no longer appears in any URL. */
export const BOARD_PATH_PREFIX = "/collection/board"

export function boardPath(slug: string): string {
  return `${BOARD_PATH_PREFIX}/${encodeURIComponent(slug)}`
}

export function isBoardPath(pathname: string): boolean {
  return pathname.startsWith(`${BOARD_PATH_PREFIX}/`)
}

/** Slug from a board pathname, or null. Used by tracking, which has no router. */
export function boardSlugFromPath(pathname: string): string | null {
  if (!isBoardPath(pathname)) return null
  const raw = pathname.slice(BOARD_PATH_PREFIX.length + 1).split("/")[0] ?? ""
  if (!raw) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}
