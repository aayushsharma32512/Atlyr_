// Caller-role check and an in-memory limiter for anonymous callers of the search functions.
// The JWT is decoded, not verified: the gateway already verified it before the request arrived.

export type CallerRole = "anon" | "authenticated" | "service_role" | "unknown"

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  const binary = atob(padded)
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

export function callerRole(req: Request): CallerRole {
  const header = req.headers.get("Authorization") ?? ""
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) return "unknown"
  const segments = match[1].split(".")
  if (segments.length < 2) return "unknown"
  try {
    const payload = JSON.parse(decodeBase64Url(segments[1]))
    const role = payload?.role
    if (role === "anon" || role === "authenticated" || role === "service_role") return role
    return "unknown"
  } catch {
    return "unknown"
  }
}

type AnonLimiterOptions = { windowMs: number; max: number }

// Keyed by client IP because anon callers have no user id; a restart or a second instance resets the counts.
export function anonLimiter({ windowMs, max }: AnonLimiterOptions): { allow(req: Request): boolean } {
  const hits = new Map<string, { count: number; resetAt: number }>()

  // The proxy appends the real address last, so a client-supplied first entry cannot pick the key.
  function clientIp(req: Request): string {
    const direct = req.headers.get("cf-connecting-ip")
    if (direct) return direct.trim()
    const forwarded = req.headers.get("x-forwarded-for")
    if (forwarded) return forwarded.split(",").at(-1)!.trim()
    return "unknown"
  }

  function sweep(now: number) {
    for (const [key, record] of hits) {
      if (now >= record.resetAt) hits.delete(key)
    }
  }

  return {
    allow(req: Request): boolean {
      const now = Date.now()
      if (hits.size > 5000) sweep(now)

      const ip = clientIp(req)
      const record = hits.get(ip)
      if (!record || now >= record.resetAt) {
        hits.set(ip, { count: 1, resetAt: now + windowMs })
        return true
      }
      if (record.count >= max) return false
      record.count++
      return true
    },
  }
}
