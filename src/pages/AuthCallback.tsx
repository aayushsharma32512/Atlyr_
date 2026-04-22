import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"

import { useAuth } from "@/contexts/AuthContext"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { getAuthIntent, clearAuthIntent } from "@/features/auth/authIntentStorage"
import {
  clearPendingInviteCode,
  clearReturningMarker,
  getPendingInviteCode,
  setReturningMarker,
} from "@/features/auth/inviteStorage"
import { useHasAppAccessQuery, useRedeemInviteMutation } from "@/features/auth/hooks/useInviteAccess"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { useToast } from "@/hooks/use-toast"

type CallbackStatus = "waiting" | "redeeming" | "checking" | "blocked"

export default function AuthCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, loading, signOut } = useAuth()
  const { profile, role } = useProfileContext()
  const analytics = useEngagementAnalytics()
  const { toast } = useToast()

  const inviteFromQuery = useMemo(() => searchParams.get("invite")?.trim() || null, [searchParams])
  const next = useMemo(() => searchParams.get("next") || "/app", [searchParams])

  const inviteCode = useMemo(() => inviteFromQuery || getPendingInviteCode(), [inviteFromQuery])
  const [status, setStatus] = useState<CallbackStatus>("waiting")
  const [message, setMessage] = useState<string>("Finalizing sign-in…")
  const redeemAttempted = useRef(false)
  const redeemSucceeded = useRef(false)

  const redeemInviteMutation = useRedeemInviteMutation()
  // Only check access if no invite redeem OR if redeem failed
  const accessQuery = useHasAppAccessQuery(status === "checking" && !redeemSucceeded.current)
  const authSuccessEmitted = useRef(false)

  const proceedWithAuth = () => {
    if (!authSuccessEmitted.current && user) {
      authSuccessEmitted.current = true

      const intent = getAuthIntent()
      clearAuthIntent()

      const outcome = intent ?? (inviteCode ? "signup" : "login")

      analytics.capture(outcome === "signup" ? "auth_signup_succeeded" : "auth_login_succeeded")

      const email = user.email ?? null
      const name = typeof profile?.name === "string" ? profile.name : null

      analytics.identify(user.id, {
        email,
        name,
        role,
      })
    }

    setReturningMarker()
    navigate(next, { replace: true })
  }

  useEffect(() => {
    if (loading) return

    if (!user) {
      setStatus("blocked")
      setMessage("We couldn’t sign you in. Try logging in again.")
      return
    }

    if (inviteCode && !redeemAttempted.current) {
      redeemAttempted.current = true
      setStatus("redeeming")
      setMessage("Redeeming your invite…")

      redeemInviteMutation.mutate(inviteCode, {
        onSuccess: (result) => {
          if (!result.success) {
            setStatus("blocked")
            setMessage("That invite code can’t be redeemed anymore. Request a new invite.")
            return
          }

          redeemSucceeded.current = true
          clearPendingInviteCode()
          setStatus("checking")
          setMessage("Verifying access…")
        },
        onError: () => {
          setStatus("blocked")
          setMessage("We couldn’t redeem that invite right now. Please try again.")
        },
      })

      return
    }

    // Only proceed to access check if NOT waiting for redeem to complete
    const isWaitingForRedeem = inviteCode && redeemAttempted.current && !redeemSucceeded.current

    if (isWaitingForRedeem) return

    setStatus("checking")
    setMessage("Verifying access…")
  }, [inviteCode, loading, redeemInviteMutation, user])

  useEffect(() => {
    if (status !== "checking") return

    // If redeem succeeded, trust that and proceed - don’t check access (avoids read-after-write issues)
    if (redeemSucceeded.current) {
      const timer = setTimeout(() => {
        proceedWithAuth()
      }, 100)
      return () => clearTimeout(timer)
    }

    if (accessQuery.isLoading) return

    const timer = setTimeout(() => {
      if (accessQuery.isError || !accessQuery.data) {
        setStatus("blocked")
        setMessage("Access isn’t enabled for this account yet.")
        return
      }

      proceedWithAuth()
    }, 100)

    return () => clearTimeout(timer)
  }, [
    accessQuery.data,
    accessQuery.isError,
    accessQuery.isLoading,
    analytics,
    inviteCode,
    navigate,
    next,
    profile?.name,
    role,
    status,
    user,
  ])

  useEffect(() => {
    if (status !== "blocked") return

    clearPendingInviteCode()
    clearReturningMarker()

    signOut()
      .catch(() => null)
      .finally(() => {
        toast({
          title: "Invite required",
          description: "Please redeem your invite code to continue.",
          variant: "destructive",
        })
        navigate("/auth/signup", { replace: true })
      })
  }, [navigate, signOut, status, toast])

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
