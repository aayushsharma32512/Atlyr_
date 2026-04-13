import type { Surface } from "./specTypes"

export type SurfaceContext = {
  surface: Surface | null
  // Optional, event-level props for screen_entered; only populated when relevant.
  props: Record<string, unknown>
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0
}

function pickCollectionTab(tabParam: string | null): Surface {
  if (tabParam === "creations") return "collections_creations"
  if (tabParam === "products") return "collections_products"
  return "collections_moodboards"
}

function getAuthSurface(pathname: string): Surface | null {
  if (pathname === "/auth/login") return "auth_login"
  if (pathname === "/auth/signup") return "auth_signup"
  if (pathname === "/auth/callback") return "auth_callback"
  return null
}

function getLandingSurface(pathname: string): Surface | null {
  if (pathname === "/" || pathname === "/waitlist" || pathname === "/landing" || pathname === "/marketing") {
    return "landing"
  }
  return null
}

export function computeSurfaceContext(opts: {
  pathname: string
  search: string
  isReturningDevice: boolean
  referrer: string
}): SurfaceContext {
  const { pathname, search, isReturningDevice, referrer } = opts
  const params = new URLSearchParams(search)

  const landing = getLandingSurface(pathname)
  if (landing) {
    const props: Record<string, unknown> = {
      landing_path: pathname,
      referrer,
      is_returning_device: isReturningDevice,
    }

    // Capture all utm_* params present (do not invent absent keys).
    for (const [key, value] of params.entries()) {
      if (!key.startsWith("utm_")) continue
      if (!isNonEmptyString(value)) continue
      props[key] = value
    }

    return { surface: "landing", props }
  }

  const authSurface = getAuthSurface(pathname)
  if (authSurface) {
    return {
      surface: authSurface,
      props: {
        has_invite_param: isNonEmptyString(params.get("invite")),
      },
    }
  }

  if (pathname === "/home") {
    const moodboardSlug = params.get("moodboard")
    if (isNonEmptyString(moodboardSlug)) {
      // Canonicalize legacy alias that can still arrive via old deep links/bookmarks.
      const canonical = moodboardSlug === "generations" ? "try-ons" : moodboardSlug
      return { surface: "home_moodboard", props: { moodboard_slug: canonical } }
    }
    return { surface: "home_feed", props: {} }
  }

  if (pathname === "/search") {
    return { surface: "search_results", props: {} }
  }

  if (pathname === "/collection") {
    return { surface: pickCollectionTab(params.get("tab")), props: {} }
  }

  if (pathname === "/profile") {
    return { surface: "profile", props: {} }
  }

  if (pathname === "/studio") {
    return { surface: "studio_main", props: {} }
  }

  if (pathname === "/studio/alternatives") {
    return { surface: "studio_alternatives", props: {} }
  }

  if (pathname === "/studio/scroll-up") {
    return { surface: "studio_scroll_up", props: {} }
  }

  if (pathname === "/studio/likeness") {
    return { surface: "studio_likeness", props: {} }
  }

  if (pathname.startsWith("/studio/product/")) {
    return { surface: "studio_product_page", props: {} }
  }

  if (pathname === "/studio/similar") {
    return { surface: "studio_similar", props: {} }
  }

  if (pathname === "/studio/outfit-suggestions") {
    return { surface: "studio_outfit_suggestions", props: {} }
  }

  return { surface: null, props: {} }
}
