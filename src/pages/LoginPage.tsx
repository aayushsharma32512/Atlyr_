import { useMemo, useState } from "react"
import { Link, useLocation, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { WordmarkLockup } from "@/design-system/primitives"
import { useAuth } from "@/contexts/AuthContext"
import { Loader2 } from "lucide-react"
import { setAuthIntent } from "@/features/auth/authIntentStorage"

// Nothing is known about approval here — access is checked only after Google
// returns, in AuthCallback via has_app_access() — so copy never promises entry.
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <WordmarkLockup size="landing" />

        <h1 className="mt-8 text-center font-display text-4xl font-medium leading-[1.12] text-foreground sm:text-5xl">
          Come <span className="font-display italic text-violet">in</span>.
        </h1>

        {error && (
          <p role="alert" className="mt-5 rounded-control border border-hairline bg-card px-3 py-2 text-center text-sm text-destructive">
            {error}
          </p>
        )}

        <Button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="mt-7 h-12 w-full rounded-control bg-foreground text-background hover:bg-foreground/90"
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

        <p className="mt-4 text-center text-sm leading-[1.6] text-muted-foreground">
          One account: likeness, boards, try-ons.
        </p>

        <p className="mt-2 text-center text-sm leading-[1.6] text-muted-foreground">
          New here?{" "}
          <Link to="/?waitlist=1" className="font-medium text-foreground underline underline-offset-2">
            Join the waitlist
          </Link>
        </p>

        <p className="mt-8 text-center text-xs leading-[1.6] text-muted-foreground">
          By continuing, you agree to our{" "}
          <Link to="/terms" className="underline underline-offset-2 hover:text-foreground">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  )
}

export default LoginPage
