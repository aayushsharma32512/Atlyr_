// No Supabase import here: these are pure, so they can be unit-tested without env.

/** Base58-style — no 0/O/I/l, so a slug read aloud or retyped is unambiguous. */
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ"
export const SLUG_LENGTH = 8

export function generateShareSlug(length = SLUG_LENGTH): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let slug = ""
  for (const byte of bytes) slug += ALPHABET[byte % ALPHABET.length]
  return slug
}

/**
 * A share link may only ever send someone back into this app. Anything that
 * could resolve to another host — a scheme, a protocol-relative `//`, a
 * backslash — is refused both here and by the table's CHECK constraint.
 */
export function isSafeSharePath(path: string): boolean {
  return /^\/(?![/\\])/.test(path) && !/[\\\s]/.test(path) && !/^\/[^?#]*:\/\//.test(path)
}
