import { useEffect } from "react"
import { useLocation } from "react-router-dom"

/**
 * Ops surfaces keep the pre-Kalagriha stone theme. Everything else gets the
 * Tantu palette.
 *
 * The flag is a `data-surface` attribute on <html> rather than a class on a
 * wrapper element, and that is load-bearing: dialogs, drawers, popovers and
 * toasts all portal to document.body, so a wrapper would leave them inheriting
 * the brand palette while the dashboard behind them stayed stone. Scoping at
 * the document root keeps a portalled ingestion dialog looking exactly as it
 * did before.
 *
 * Token values for each register live in src/index.css (`:root` and
 * `:root[data-surface="ops"]`). Nothing under src/components/ingestion-*,
 * src/components/hitl or src/pages/admin is touched.
 */
const OPS_PATH_PREFIXES = ["/admin", "/hitl"] as const

/**
 * Admin-only previews of buyer-journey screens. They live under /admin so the
 * admin guard applies, but they must render in the APP register — previewing
 * the Kalagriha design in the ops stone theme would defeat the point.
 */
export const DESIGN_PREVIEW_PREFIX = "/admin/design-system"

export function isDesignPreviewPath(pathname: string): boolean {
  return pathname.startsWith(DESIGN_PREVIEW_PREFIX)
}

export type SurfaceRegister = "app" | "ops"

export function resolveSurface(pathname: string): SurfaceRegister {
  if (isDesignPreviewPath(pathname)) {
    return "app"
  }

  return OPS_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
    ? "ops"
    : "app"
}

export function useSurfaceTheme(): void {
  const { pathname } = useLocation()

  useEffect(() => {
    document.documentElement.dataset.surface = resolveSurface(pathname)
  }, [pathname])
}
