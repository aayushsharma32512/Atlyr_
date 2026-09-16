import { useEffect, type ReactNode } from "react"
import { Outlet, useLocation, useNavigate } from "react-router-dom"

import { BottomNavBar } from "@/design-system/primitives"
import { readStudioLastPath } from "@/features/studio/constants"
import {
  FIRST_RUN_ENTRY_PATH,
  isFirstRunPath,
  needsFirstRun,
} from "@/features/profile/constants/firstRun"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useAuth } from "@/contexts/AuthContext"
import { useGuest } from "@/contexts/GuestContext"
import { useStudioShareMode } from "@/features/studio/hooks/useStudioShareMode"
import { useSaveTray } from "@/features/collections/providers/SaveTrayProvider"
import { readReturnTo } from "@/utils/returnTo"

interface AppShellLayoutProps {
  children?: ReactNode
  /** For screens that own the whole frame, e.g. Studio's alternates panel. */
  hideNav?: boolean
}

export function AppShellLayout({ children, hideNav = false }: AppShellLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { gender, profile, isLoading } = useProfileContext()
  const { user } = useAuth()
  const { guestState } = useGuest()
  const { isViewOnly } = useStudioShareMode()
  const { isOpen: isSaveTrayOpen } = useSaveTray()

  const activeId = getActiveNavId(location.pathname, location.search)

  useEffect(() => {
    if (!user || guestState.isGuest || isLoading) {
      return
    }

    if (isFirstRunPath(location.pathname)) {
      return
    }

    if (needsFirstRun(profile)) {
      navigate(FIRST_RUN_ENTRY_PATH, { replace: true })
    }
  }, [guestState.isGuest, isLoading, location.pathname, navigate, profile, user])

  const handleNavigate = (id: string) => {
    switch (id) {
      case "collections":
        navigate("/collection")
        break
      case "studio": {
        // Scoped by gender, so a profile switch does not resume the old figure's studio.
        navigate(readStudioLastPath(gender))
        break
      }
      case "search":
        // A tab tap lands on the reset state; the screen skips its session restore.
        navigate("/search", { replace: false, state: { fresh: true } })
        break
      case "notifications":
        navigate("/notifications")
        break
      case "profile":
        navigate("/profile")
        break
      default:
        break
    }
  }

  // The padding only exists to clear the bar, so it goes when the bar does.
  // The save tray owns the bottom of the screen while it is up, as on Studio.
  const showNav = !isViewOnly && !hideNav && !isSaveTrayOpen

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <main
        className={`flex flex-1 flex-col overflow-hidden${showNav ? " pb-[2.5rem] sm:pb-10" : ""}`}
      >
        {children ?? <Outlet />}
      </main>
      {showNav ? (
        <BottomNavBar
          activeId={activeId}
          onNavigate={handleNavigate}
          className="fixed inset-x-0 bottom-0 z-20 border-t"
        />
      ) : null}
    </div>
  )
}

/**
 * The product page is a detail view, not a tab: Collections, Search and Studio
 * all open it at /studio/product/:id. Its `?returnTo=` names the opener, so the
 * bar stays lit on the tab you actually came from instead of jumping to Studio.
 */
function getActiveNavId(pathname: string, search: string) {
  if (pathname.startsWith("/studio/product/")) {
    const openedFrom = readReturnTo(search)
    const owner = openedFrom ? matchNavId(openedFrom) : undefined
    if (owner) {
      return owner
    }
  }

  // Find items is not a tab: it belongs to Search, or to Boards when opened
  // from the wardrobe card (?intent=wardrobe).
  if (pathname.startsWith("/inspiration-import")) {
    return search.includes("intent=wardrobe") ? "collections" : "search"
  }

  return matchNavId(pathname)
}

// /home has no tab any more, so it reports no active id. The route still works.
function matchNavId(pathname: string) {
  if (pathname.startsWith("/collection") || pathname.startsWith("/design-system/collection")) {
    return "collections"
  }

  if (pathname.startsWith("/studio") || pathname.startsWith("/design-system/studio")) {
    return "studio"
  }

  if (pathname.startsWith("/search") || pathname.startsWith("/design-system/search")) {
    return "search"
  }

  if (pathname.startsWith("/notifications")) {
    return "notifications"
  }

  if (pathname.startsWith("/profile") || pathname.startsWith("/design-system/profile")) {
    return "profile"
  }

  return undefined
}
