/**
 * Reads the `?returnTo=` a detail screen was opened with.
 *
 * Callers encode it once (`encodeURIComponent`) or twice (`params.set` on an
 * already-encoded value), so decode defensively. Only same-origin paths come
 * back — a query param must never be able to drive an off-site jump.
 */
export function readReturnTo(search: string): string | null {
  const raw = new URLSearchParams(search).get("returnTo")
  if (!raw) {
    return null
  }

  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    // Malformed escape — treat what we got as already decoded.
  }

  return decoded.startsWith("/") && !decoded.startsWith("//") ? decoded : null
}
