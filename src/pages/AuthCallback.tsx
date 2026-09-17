import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"

import { useAuth } from "@/contexts/AuthContext"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { getAuthIntent, clearAuthIntent } from "@/features/auth/authIntentStorage"
import { clearPendingInviteCode, getPendingInviteCode, setReturningMarker } from "@/features/auth/inviteStorage"
import { inviteErrorText } from "@/features/auth/inviteCode"
import { useHasAppAccessQuery, useRedeemInviteMutation } from "@/features/auth/hooks/useInviteAccess"
import { authKeys } from "@/features/auth/queryKeys"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { useToast } from "@/hooks/use-toast"

// After Google sign-in, access = has_app_access(): the email is approved on the waitlist,
// or the user has redeemed an invite code. A code entered before sign-in is redeemed here.
export default function AuthCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, loading } = useAuth()
  const { profile, role } = useProfileContext()
  const analytics = useEngagementAnalytics()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const redeem = useRedeemInviteMutation()

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
    doneRef.current = true

    const enter = () => {
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
    }

    const hasAccess = !accessQuery.isError && Boolean(accessQuery.data)
    if (hasAccess) {
      clearPendingInviteCode()
      enter()
      return
    }

    const pendingCode = getPendingInviteCode()
    if (!pendingCode) {
      navigate(`/auth/invite?next=${encodeURIComponent(next)}`, { replace: true })
      return
    }

    setMessage("Redeeming your invite…")
    redeem.mutateAsync(pendingCode)
      .then((result) => {
        clearPendingInviteCode()
        if (!result.success) {
          toast({ title: "Invite code not accepted", description: inviteErrorText(result.error), variant: "destructive" })
          navigate(`/auth/invite?next=${encodeURIComponent(next)}`, { replace: true })
          return
        }
        // AppRouter reads the same cached access flag; flip it so it doesn't bounce on stale "false".
        queryClient.setQueryData(authKeys.access(user.id), true)
        enter()
      })
      .catch(() => {
        toast({ title: "Invite code not accepted", description: inviteErrorText(null), variant: "destructive" })
        navigate(`/auth/invite?next=${encodeURIComponent(next)}`, { replace: true })
      })
  }, [
    loading, user, accessQuery.isLoading, accessQuery.isFetching, accessQuery.data, accessQuery.isError,
    navigate, toast, analytics, profile?.name, role, next, redeem, queryClient,
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
