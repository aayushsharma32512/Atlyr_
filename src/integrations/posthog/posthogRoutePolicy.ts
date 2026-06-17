export const POSTHOG_ALLOWED_HOSTNAMES = new Set(["www.atlyr.app", "atlyr.app"])

const EXACT_ALLOWED_PATHS = new Set([
  "/",
  "/waitlist",
  "/landing",
  "/marketing",
  "/auth/login",
  "/auth/signup",
  "/auth/callback",
])

const PREFIX_ALLOWED_PATHS = ["/home", "/search", "/collection", "/studio", "/profile"]

export function isPostHogAllowedPath(pathname: string): boolean {
  if (EXACT_ALLOWED_PATHS.has(pathname)) return true
  return PREFIX_ALLOWED_PATHS.some((prefix) => pathname.startsWith(prefix))
}

export function shouldDisablePostHogForLocation(opts: {
  hostname: string
  pathname: string
}): boolean {
  const { hostname, pathname } = opts

  if (!POSTHOG_ALLOWED_HOSTNAMES.has(hostname)) {
    console.log("[PostHog] BLOCKED — hostname not allowed:", hostname, "| allowed:", [...POSTHOG_ALLOWED_HOSTNAMES])
    return true
  }

  if (pathname.startsWith("/app")) {
    console.log("[PostHog] BLOCKED — legacy /app path:", pathname)
    return true
  }

  if (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/hitl") ||
    pathname.startsWith("/design-system") ||
    pathname.startsWith("/mannequin")
  ) {
    console.log("[PostHog] BLOCKED — excluded path:", pathname)
    return true
  }

  if (!isPostHogAllowedPath(pathname)) {
    console.log("[PostHog] BLOCKED — path not in allowed list:", pathname)
    return true
  }

  console.log("[PostHog] ALLOWED —", hostname, pathname)
  return false
}
