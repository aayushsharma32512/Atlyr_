import { useMemo, useState } from "react"
import { Link, useLocation, useSearchParams } from "react-router-dom"
import { WordmarkLockup } from "@/design-system/primitives"
import { useAuth } from "@/contexts/AuthContext"
import { GoogleButton } from "@/features/auth/components/GoogleButton"
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

        <GoogleButton
          onClick={handleGoogleSignIn}
          loading={loading}
          label={isSignup ? "Continue with Google" : "Sign in with Google"}
          className="mt-7"
        />

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
