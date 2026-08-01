import { useMemo, useState } from "react"
import { Link, useLocation, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { WordmarkLockup } from "@/design-system/primitives"
import { useAuth } from "@/contexts/AuthContext"
import { Loader2 } from "lucide-react"
import { setAuthIntent } from "@/features/auth/authIntentStorage"

/**
 * Canvas 6b — "sign in, one door". The charcoal room: signing in is structural,
 * not promotional, so there is no marketing here and no second action.
 *
 * Two deliberate departures from the canvas art:
 *
 *  · It draws the eyebrow "INVITE ACCEPTED" and the headline "Come in, you're on
 *    the list." Nothing is known about approval at this point — access is checked
 *    only after Google returns, in AuthCallback via has_app_access(). Telling
 *    someone they're on the list and then signing them back out on the next
 *    screen is precisely the kind of promise the voice rules forbid, so the copy
 *    states the invitation model without asserting an outcome.
 *
 *  · The guest-mode link is dropped. signInAsGuest() exists but its only caller
 *    is the unrouted AuthScreen, so the link would have been decorative.
 */
export function LoginPage() {
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const isSignup = location.pathname === "/auth/signup"
  const next = useMemo(() => searchParams.get("next") || "/app", [searchParams])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { signInWithGoogle } = useAuth()

  // Access is granted by email approval (waitlist status invited/converted), checked in
  // AuthCallback via has_app_access() — so sign-in is just Google, no invite code.
  const handleGoogleSignIn = async () => {
    setLoading(true)
    setError(null)

    try {
      setAuthIntent(isSignup ? "signup" : "login")

      const callbackUrl = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`

      const { error } = await signInWithGoogle(callbackUrl)
      if (error) {
        setError(error.message)
      }
    } catch {
      setError("An unexpected error occurred. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-ink px-6 py-12">
      {/* The weave, at low contrast — the room is a surface, not a poster. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.45]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--ink-line)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--ink-line)) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />

      <div className="relative z-10 w-full max-w-[330px]">
        <WordmarkLockup size="firstRun" onDark />

        <p className="mt-8 text-center text-[8.5px] font-semibold uppercase tracking-[0.22em] text-primary">
          By invitation
        </p>
        <h1 className="mt-[7px] text-center font-display text-[26px] font-medium leading-[1.12] text-background">
          Come in.
        </h1>

        {error && (
          <p
            role="alert"
            className="mt-5 rounded-[3px] bg-destructive/15 px-3 py-2 text-center text-[11px] text-destructive-foreground"
          >
            {error}
          </p>
        )}

        <Button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="mt-7 h-auto w-full rounded-[3px] bg-secondary py-[15px] text-[13px] font-bold text-foreground hover:bg-secondary/90"
        >
          {loading ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
          )}
          {isSignup ? "Continue with Google" : "Sign in with Google"}
        </Button>

        <p className="mt-4 text-center text-[9.5px] leading-[1.6] text-on-ink-1">
          One account: likeness, boards, try-ons.
          <br />
          Photos stay private — delete anytime.
        </p>

        <p className="mt-8 text-center text-[9px] leading-[1.6] text-on-ink-1/70">
          By continuing, you agree to our{" "}
          <Link to="/terms" className="underline underline-offset-2 hover:text-on-ink-2">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link to="/privacy" className="underline underline-offset-2 hover:text-on-ink-2">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  )
}

export default LoginPage
