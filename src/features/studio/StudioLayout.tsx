import { useEffect, type ReactNode } from "react"
import { Link, Outlet, useLocation } from "react-router-dom"

import { AppShellLayout } from "@/layouts/AppShellLayout"
import { StudioContextProvider } from "./context/StudioContext"
import { isStudioProductPath, rememberStudioLastPath } from "@/features/studio/constants"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useStudioShareMode } from "@/features/studio/hooks/useStudioShareMode"
import { StudioTourProvider } from "./context/StudioTourContext"
import { StudioTour } from "./components/StudioTour"

interface StudioLayoutProps {
  children?: ReactNode
}

export function StudioLayout({ children }: StudioLayoutProps) {
  const location = useLocation()
  const { isViewOnly } = useStudioShareMode()
  const { gender } = useProfileContext()

  useEffect(() => {
    // A detail view reached from any tab — remembering it would make the Studio
    // tab resume onto a product rather than the workbench.
    if (isStudioProductPath(location.pathname)) {
      return
    }
    rememberStudioLastPath(gender, `${location.pathname}${location.search}`)
  }, [gender, location.pathname, location.search])

  return (
    <StudioTourProvider>
      <StudioContextProvider>
        <AppShellLayout>
          {children ?? <Outlet />}
          <StudioTour />
          {isViewOnly ? (
          <div className="fixed inset-x-0 bottom-0 z-30 px-4 pb-1">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 rounded-2xl border border-border/60 bg-card/95 p-1 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-foreground">Want to edit or save this outfit?</span>
                <span className="text-xs text-muted-foreground">
                  Join the waitlist or log in to unlock the full studio.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to="/?waitlist=1"
                  className="inline-flex h-9 items-center justify-center rounded-full border border-border/70 px-4 text-xs font-medium text-foreground hover:bg-muted/40"
                >
                  Join waitlist
                </Link>
                <Link
                  to={`/auth/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`}
                  className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Log in
                </Link>
              </div>
            </div>
          </div>
        ) : null}
      </AppShellLayout>
    </StudioContextProvider>
  </StudioTourProvider>
  )
}

