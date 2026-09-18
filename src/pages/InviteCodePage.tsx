import { useMemo, useState } from "react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Icons } from "@/design-system/icons"
import { WordmarkLockup } from "@/design-system/primitives"
import { useAuth } from "@/contexts/AuthContext"
import { GoogleButton } from "@/features/auth/components/GoogleButton"
import {
  useHasAppAccessQuery,
  useInviteValidationQuery,
  useRedeemInviteMutation,
  useValidateInviteMutation,
} from "@/features/auth/hooks/useInviteAccess"
import { setAuthIntent } from "@/features/auth/authIntentStorage"
import { inviteErrorText, normalizeInviteCode } from "@/features/auth/inviteCode"
import {
  clearPendingInviteCode,
  clearReturningMarker,
  setPendingInviteCode,
  setReturningMarker,
} from "@/features/auth/inviteStorage"
import { authKeys } from "@/features/auth/queryKeys"

const INPUT =
  "h-12 w-full rounded-control border border-hairline bg-card text-center font-mono uppercase tracking-[0.2em] text-foreground outline-none focus:border-violet"
const LINK = "underline underline-offset-2 hover:text-foreground"

function callbackUrl() {
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent("/app")}`
}

// The one invite screen, on both sides of Google. Before sign-in (an invite link or a typed
// code) the code is checked here and redeemed by the callback; after sign-in it is redeemed here.
export function InviteCodePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { user, loading, signInWithGoogle } = useAuth()
  const accessQuery = useHasAppAccessQuery(Boolean(user?.id))
  const redeem = useRedeemInviteMutation()
  const validate = useValidateInviteMutation()
  const next = useMemo(() => searchParams.get("next") || "/app", [searchParams])
  const linkCode = useMemo(() => normalizeInviteCode(searchParams.get("code")), [searchParams])
  // Only a signed-out visitor gets the link's code checked up front; signed in, the redeem is the check.
  const linkCheck = useInviteValidationQuery(!loading && !user ? linkCode : null)
  const [code, setCode] = useState(linkCode ?? "")
  const [error, setError] = useState<string | null>(null)
  const [redirecting, setRedirecting] = useState(false)

  if (loading) return null
  if (user && accessQuery.data === true) return <Navigate to={next} replace />

  const startGoogle = async (inviteCode: string | null, intent: "login" | "signup") => {
    setError(null)
    if (inviteCode) setPendingInviteCode(inviteCode)
    else clearPendingInviteCode()
    setAuthIntent(intent)
    setRedirecting(true)
    const { error: signInError } = await signInWithGoogle(callbackUrl())
    if (signInError) {
      setRedirecting(false)
      setError("Could not start Google sign-in. Please try again.")
    }
  }

  const submitBeforeSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const result = await validate.mutateAsync(code)
      if (!result.valid) {
        setError(inviteErrorText(result.error))
        return
      }
      await startGoogle(code, "signup")
    } catch {
      setError(inviteErrorText(null))
    }
  }

  const submitAfterSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!user) return
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
  const switchAccount = () => {
    clearReturningMarker()
    void startGoogle(null, "login")
  }

  const linkValid = Boolean(linkCode) && linkCheck.data?.valid === true
  const linkChecking = Boolean(linkCode) && !user && linkCheck.isPending && !linkCheck.isError
  const linkProblem =
    linkCode && !user && (linkCheck.isError || linkCheck.data?.valid === false)
      ? inviteErrorText(linkCheck.data?.error ?? null)
      : null

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

        {!user && linkChecking ? (
          <p className="mt-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking your invite…
          </p>
        ) : !user && linkValid && linkCode ? (
          <>
            <h1 className="mt-8 text-center font-display text-4xl font-medium leading-[1.12] text-foreground sm:text-5xl">
              You're <span className="font-display italic text-violet">invited</span>.
            </h1>
            <p className="mt-4 text-center text-sm leading-[1.6] text-muted-foreground">
              Continue with Google and you're in.
            </p>
            <p className="mt-6 text-center font-mono text-sm uppercase tracking-[0.2em] text-foreground">{linkCode}</p>
            <GoogleButton
              label="Continue with Google"
              onClick={() => void startGoogle(linkCode, "signup")}
              loading={redirecting}
              className="mt-5"
            />
            {error && (
              <p role="alert" className="mt-3 rounded-control border border-hairline bg-card px-3 py-2 text-center text-sm text-destructive">
                {error}
              </p>
            )}
            <p className="mt-8 text-center text-sm text-muted-foreground">
              <Link to="/" className={LINK}>
                Not now
              </Link>
            </p>
          </>
        ) : !user ? (
          <>
            <h1 className="mt-8 text-center font-display text-4xl font-medium leading-[1.12] text-foreground sm:text-5xl">
              {linkProblem ? (
                <>
                  This invite <span className="font-display italic text-violet">can't be used</span>.
                </>
              ) : (
                <>
                  Enter your <span className="font-display italic text-violet">invite code</span>.
                </>
              )}
            </h1>
            <p className="mt-4 text-center text-sm leading-[1.6] text-muted-foreground">
              {linkProblem ?? "Have a code? Enter it, then continue with Google."}
            </p>
            <form onSubmit={submitBeforeSignIn} className="mt-7 flex flex-col gap-3">
              <input
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ATLYR-XXXXXX"
                autoComplete="off"
                spellCheck={false}
                aria-label="Invite code"
                aria-invalid={Boolean(error)}
                className={INPUT}
              />
              {error && (
                <p role="alert" className="rounded-control border border-hairline bg-card px-3 py-2 text-center text-sm text-destructive">
                  {error}
                </p>
              )}
              <GoogleButton
                type="submit"
                label="Continue with Google"
                loading={validate.isPending || redirecting}
                disabled={!code.trim()}
              />
            </form>
            <p className="mt-8 text-center text-sm text-muted-foreground">
              No code?{" "}
              <Link to="/?waitlist=1" className={LINK}>
                Join the waitlist
              </Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-8 text-center font-display text-4xl font-medium leading-[1.12] text-foreground sm:text-5xl">
              Enter your <span className="font-display italic text-violet">invite code</span>.
            </h1>
            <p className="mt-4 text-center text-sm leading-[1.6] text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{user.email}</span>.
              <br />
              This account isn't approved yet.
            </p>
            <form onSubmit={submitAfterSignIn} className="mt-7 flex flex-col gap-3">
              <input
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ATLYR-XXXXXX"
                autoComplete="off"
                spellCheck={false}
                aria-label="Invite code"
                aria-invalid={Boolean(error)}
                className={INPUT}
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
                <Link to="/?waitlist=1" className={LINK}>
                  Join the waitlist
                </Link>
              </span>
              <button type="button" onClick={switchAccount} className={LINK}>
                Use a different account
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

export default InviteCodePage
