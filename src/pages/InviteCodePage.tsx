import { useMemo, useState } from "react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Icons } from "@/design-system/icons"
import { WordmarkLockup } from "@/design-system/primitives"
import { useAuth } from "@/contexts/AuthContext"
import { useHasAppAccessQuery, useRedeemInviteMutation } from "@/features/auth/hooks/useInviteAccess"
import { setAuthIntent } from "@/features/auth/authIntentStorage"
import { inviteErrorText } from "@/features/auth/inviteCode"
import { clearPendingInviteCode, clearReturningMarker, setReturningMarker } from "@/features/auth/inviteStorage"
import { authKeys } from "@/features/auth/queryKeys"

// Signed in, but not approved and no code redeemed yet. The one place a code can be
// redeemed after sign-in, so nobody is signed out into a dead end.
export function InviteCodePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { user, loading, signInWithGoogle } = useAuth()
  const accessQuery = useHasAppAccessQuery(Boolean(user?.id))
  const redeem = useRedeemInviteMutation()

  const next = useMemo(() => searchParams.get("next") || "/app", [searchParams])
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)

  if (loading) return null
  if (!user) return <Navigate to={`/auth/login?next=${encodeURIComponent("/auth/invite")}`} replace />
  if (accessQuery.data === true) return <Navigate to={next} replace />

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const result = await redeem.mutateAsync(code)
      if (!result.success) {
        setError(inviteErrorText(result.error))
        return
      }
      clearPendingInviteCode()
      queryClient.setQueryData(authKeys.access(user.id), true)
      setReturningMarker()
      navigate(next, { replace: true })
    } catch {
      setError(inviteErrorText(null))
    }
  }

  // Straight to Google's chooser; the callback replaces the session, so no sign-out and no login page in between.
  const switchAccount = async () => {
    clearPendingInviteCode()
    clearReturningMarker()
    setAuthIntent("login")
    const { error } = await signInWithGoogle(`${window.location.origin}/auth/callback?next=${encodeURIComponent("/app")}`)
    if (error) setError("Could not start Google sign-in. Please try again.")
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
      <Link
        to="/"
        aria-label="Back to Atlyr"
        className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center text-ink"
      >
        <Icons.carouselPrev className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
      </Link>
      <div className="w-full max-w-sm">
        <WordmarkLockup size="landing" />

        <h1 className="mt-8 text-center font-display text-4xl font-medium leading-[1.12] text-foreground sm:text-5xl">
          Enter your <span className="font-display italic text-violet">invite code</span>.
        </h1>
        <p className="mt-4 text-center text-sm leading-[1.6] text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{user.email}</span>.
          <br />
          This account isn't approved yet.
        </p>

        <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-3">
          <input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ATLYR-XXXXXX"
            autoComplete="off"
            spellCheck={false}
            aria-label="Invite code"
            aria-invalid={Boolean(error)}
            className="h-12 w-full rounded-control border border-hairline bg-card text-center font-mono uppercase tracking-[0.2em] text-foreground outline-none focus:border-violet"
          />
          {error && (
            <p role="alert" className="rounded-control border border-hairline bg-card px-3 py-2 text-center text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={redeem.isPending || !code.trim()}
            className="h-12 w-full rounded-control bg-foreground text-background hover:bg-foreground/90"
          >
            {redeem.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Continue"}
          </Button>
        </form>

        <p className="mt-8 flex flex-col items-center gap-1.5 text-center text-sm text-muted-foreground">
          <span>
            No code?{" "}
            <Link to="/?waitlist=1" className="underline underline-offset-2 hover:text-foreground">
              Join the waitlist
            </Link>
          </span>
          <button type="button" onClick={switchAccount} className="underline underline-offset-2 hover:text-foreground">
            Use a different account
          </button>
        </p>
      </div>
    </div>
  )
}

export default InviteCodePage
