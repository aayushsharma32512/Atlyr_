import { useMemo, useState } from "react"
import { Link, useLocation, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/contexts/AuthContext"
import { Loader2 } from "lucide-react"
import { setAuthIntent } from "@/features/auth/authIntentStorage"

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
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      {/* Logo */}
      <div className="mb-0">
        <img src="/assets/logo.png" alt="Atlyr Logo" className="h-24 w-auto" />
      </div>

      {/* Login Card */}
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border shadow-sm p-8">
        {/* Header */}
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-semibold text-foreground mb-2">
            Welcome to Atlyr
          </h2>
          <p className="text-sm text-muted-foreground">
            Sign in to continue
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-3 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Google Login Button */}
        <Button
          type="button"
          variant="outline"
          className="w-full h-11 border-border bg-background hover:bg-muted/50"
          onClick={handleGoogleSignIn}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#000000"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#000000"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#000000"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#000000"
              />
            </svg>
          )}
          {isSignup ? "Continue with Google" : "Login with Google"}
        </Button>
      </div>

      {/* Terms and Privacy */}
      <div className="mt-8 w-full text-center text-xs text-muted-foreground max-w-lg">
        <p>
          By continuing, you agree to our{" "}
          <Link
            to="/terms"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            to="/privacy"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  )
}

export default LoginPage
