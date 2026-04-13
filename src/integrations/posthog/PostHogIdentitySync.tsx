import { useEffect, useRef } from "react"

import { useAuth } from "@/contexts/AuthContext"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { shouldDisablePostHogForLocation } from "@/integrations/posthog/posthogRoutePolicy"

export function PostHogIdentitySync() {
  const analytics = useEngagementAnalytics()
  const { user } = useAuth()
  const { profile, role, isLoading: isProfileLoading } = useProfileContext()
  const prevUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    const prevUserId = prevUserIdRef.current
    const nextUserId = user?.id ?? null
    prevUserIdRef.current = nextUserId

    // Only treat as logout when transitioning from an authenticated user to no user.
    if (prevUserId && !nextUserId) {
      analytics.logoutResetAndRotateSession()
    }
  }, [analytics, user?.id])

  // Identify as soon as we know the authenticated user.
  useEffect(() => {
    if (!user?.id) return
    const hostname = window.location.hostname
    const pathname = window.location.pathname
    if (shouldDisablePostHogForLocation({ hostname, pathname })) return

    const email = user.email ?? null
    const name = typeof profile?.name === "string" ? profile.name : null

    analytics.identify(user.id, {
      email,
      name,
      role,
    })
  }, [analytics, profile?.name, role, user?.email, user?.id])

  // If profile is still loading, don't thrash person props.
  useEffect(() => {
    if (!user?.id) return
    if (isProfileLoading) return
    const hostname = window.location.hostname
    const pathname = window.location.pathname
    if (shouldDisablePostHogForLocation({ hostname, pathname })) return

    const email = user.email ?? null
    const name = typeof profile?.name === "string" ? profile.name : null

    // Ensure role/name stay updated when profile becomes available.
    analytics.identify(user.id, {
      email,
      name,
      role,
    })
  }, [analytics, isProfileLoading, profile?.name, role, user?.email, user?.id])

  return null
}
