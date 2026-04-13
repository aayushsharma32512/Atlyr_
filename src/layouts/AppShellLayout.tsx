import { useEffect, type ReactNode } from "react"
import { Outlet, useLocation, useNavigate } from "react-router-dom"

import { BottomNavBar } from "@/design-system/primitives"
import { STUDIO_LAST_PATH_STORAGE_KEY } from "@/features/studio/constants"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useAuth } from "@/contexts/AuthContext"
import { useGuest } from "@/contexts/GuestContext"
import { useStudioShareMode } from "@/features/studio/hooks/useStudioShareMode"

interface AppShellLayoutProps {
  children?: ReactNode
}

export function AppShellLayout({ children }: AppShellLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile, isLoading } = useProfileContext()
  const { user } = useAuth()
  const { guestState } = useGuest()
  const { isViewOnly } = useStudioShareMode()

  const activeId = getActiveNavId(location.pathname)

  useEffect(() => {
    if (!user || guestState.isGuest || isLoading) {
      return
    }

    if (location.pathname.startsWith("/profile/user-details")) {
      return
    }

    if (!profile || profile.onboarding_complete === false) {
      navigate("/profile/user-details", { replace: true })
    }
  }, [guestState.isGuest, isLoading, location.pathname, navigate, profile, user])

  const handleNavigate = (id: string) => {
    switch (id) {
      case "home":
        if (location.pathname.startsWith("/home")) {
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("home:reset"))
          }
          return
        }
        navigate("/home?moodboard=for-you")
        break
      case "collections":
        navigate("/collection")
        break
      case "studio": {
        const storedPath =
          typeof window !== "undefined"
            ? window.sessionStorage.getItem(STUDIO_LAST_PATH_STORAGE_KEY)
            : null
        const normalizedPath = (() => {
          if (!storedPath) {
            return "/studio"
          }
          if (storedPath.startsWith("/studio")) {
            return storedPath
          }
          if (storedPath.startsWith("/design-system/studio")) {
            return storedPath.replace("/design-system", "")
          }
          return "/studio"
        })()
        const nextPath = normalizedPath || "/studio"
        navigate(nextPath)
        break
      }
      case "search":
        // Navigate to fresh search screen without any query params (clears previous search)
        navigate("/search", { replace: false })
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

function getActiveNavId(pathname: string) {
  if (pathname.startsWith("/home") || pathname.startsWith("/design-system/home")) {
    return "home"
  }
  if (pathname.startsWith("/collection") || pathname.startsWith("/design-system/collection")) {
    return "collections"
  }

    if (pathname.startsWith("/studio") || pathname.startsWith("/design-system/studio")) {
      return "studio"
    }

  if (pathname.startsWith("/search") || pathname.startsWith("/design-system/search")) {
    return "search"
  }

  if (pathname.startsWith("/profile") || pathname.startsWith("/profile") || pathname.startsWith("/design-system/profile")) {
    return "profile"
  }

  return undefined
}
