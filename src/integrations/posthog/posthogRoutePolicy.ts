export const POSTHOG_ALLOWED_HOSTNAMES = new Set(["www.atlyr.in", "atlyr.in"])

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

  // Only capture in production domains.
  if (!POSTHOG_ALLOWED_HOSTNAMES.has(hostname)) return true

  // Explicitly exclude legacy app.
  if (pathname.startsWith("/app")) return true

  // Explicitly exclude admin/debug/design-system and other non-product areas.
  if (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/hitl") ||
    pathname.startsWith("/design-system") ||
    pathname.startsWith("/mannequin")
  ) {
    return true
  }

  // Only allow the new-app + public marketing routes.
  return !isPostHogAllowedPath(pathname)
}
