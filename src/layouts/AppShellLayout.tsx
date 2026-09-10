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
import { readReturnTo } from "@/utils/returnTo"

interface AppShellLayoutProps {
  children?: ReactNode
}

export function AppShellLayout({ children }: AppShellLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { gender, profile, isLoading } = useProfileContext()
  const { user } = useAuth()
  const { guestState } = useGuest()
  const { isViewOnly } = useStudioShareMode()

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

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <main className="flex flex-1 flex-col overflow-hidden pb-[2.5rem] sm:pb-10">
        {children ?? <Outlet />}
      </main>
      {isViewOnly ? null : (
        <BottomNavBar
          activeId={activeId}
          onNavigate={handleNavigate}
          className="fixed inset-x-0 bottom-0 z-20 border-t"
        />
      )}
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
