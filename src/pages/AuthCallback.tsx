import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"

import { useAuth } from "@/contexts/AuthContext"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { getAuthIntent, clearAuthIntent } from "@/features/auth/authIntentStorage"
import { clearReturningMarker, setReturningMarker } from "@/features/auth/inviteStorage"
import { useHasAppAccessQuery } from "@/features/auth/hooks/useInviteAccess"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { useToast } from "@/hooks/use-toast"

// Email-approval flow: after Google sign-in, access is decided by has_app_access()
// (email is invited/converted in the waitlist). No invite code anywhere.
export default function AuthCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, loading, signOut } = useAuth()
  const { profile, role } = useProfileContext()
  const analytics = useEngagementAnalytics()
  const { toast } = useToast()

  const next = useMemo(() => searchParams.get("next") || "/app", [searchParams])
  const [message, setMessage] = useState("Finalizing sign-in…")
  const doneRef = useRef(false)

  // Only query access once the session/JWT is ready (user.id present).
  const accessQuery = useHasAppAccessQuery(Boolean(user?.id))

  useEffect(() => {
    if (doneRef.current || loading) return

    // OAuth didn't produce a session.
    if (!user) {
      doneRef.current = true
      toast({ title: "Sign-in failed", description: "We couldn't sign you in. Please try again.", variant: "destructive" })
      navigate("/auth/login", { replace: true })
      return
    }

    // Wait for the access check to actually resolve before deciding (fixes the
    // "first attempt does nothing / only the 2nd try shows the message" race).
    if (accessQuery.isLoading || accessQuery.isFetching) {
      setMessage("Verifying access…")
      return
    }

    const hasAccess = !accessQuery.isError && Boolean(accessQuery.data)
    doneRef.current = true

    if (!hasAccess) {
      const email = user.email ?? "this email"
      clearReturningMarker()
      signOut().catch(() => null).finally(() => {
        toast({
          title: "Not approved yet",
          description: `${email} isn't approved yet. Please contact the admin for access.`,
          variant: "destructive",
        })
        navigate("/auth/login", { replace: true })
      })
      return
    }

    // Approved → identify + go in.
    const intent = getAuthIntent()
    clearAuthIntent()
    analytics.capture(intent === "signup" ? "auth_signup_succeeded" : "auth_login_succeeded")
    analytics.identify(user.id, {
      email: user.email ?? null,
      name: typeof profile?.name === "string" ? profile.name : null,
      role,
    })
    setReturningMarker()
    navigate(next, { replace: true })
  }, [
    loading, user, accessQuery.isLoading, accessQuery.isFetching, accessQuery.data, accessQuery.isError,
    navigate, signOut, toast, analytics, profile?.name, role, next,
  ])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <h1 className="text-lg font-semibold text-foreground">Signing you in</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  )
}
