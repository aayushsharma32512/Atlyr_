import { useMemo, useState } from "react"
import { Link, useLocation, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/contexts/AuthContext"
import { CheckCircle2, Loader2 } from "lucide-react"
import {
  setPendingInviteCode,
} from "@/features/auth/inviteStorage"
import { setAuthIntent } from "@/features/auth/authIntentStorage"
import { useValidateInviteMutation } from "@/features/auth/hooks/useInviteAccess"

export function LoginPage() {
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const isSignup = location.pathname === "/auth/signup"
  const next = useMemo(() => searchParams.get("next") || "/app", [searchParams])

  // Pre-fill invite code from query
  const inviteFromQuery = useMemo(() => searchParams.get("invite")?.trim() || null, [searchParams])
  const initialInvite = useMemo(() => inviteFromQuery || "", [inviteFromQuery])
  const hasPendingInvite = Boolean(initialInvite)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Invite code state
  const [inviteCode, setInviteCode] = useState(initialInvite)
  const [inviteChecking, setInviteChecking] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteValid, setInviteValid] = useState(false)

  const { signInWithGoogle } = useAuth()
  const inviteValidation = useValidateInviteMutation()

  // --- Step 1: Validate invite code ---
  const handleInviteCheck = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = inviteCode.trim()
    if (!trimmed) {
      setInviteError("Enter your invite code")
      return
    }
    setInviteChecking(true)
    setInviteError(null)
    setInviteValid(false)

    try {
      const result = await inviteValidation.mutateAsync(trimmed)

      if (!result.valid) {
        const reason = result.error
        const message =
          reason === "INVITE_MAXED_OUT"
            ? "That invite has already been used the maximum number of times."
            : reason === "INVITE_EXPIRED"
              ? "That invite code has expired."
              : reason === "INVITE_INACTIVE"
                ? "That invite has been disabled."
                : reason === "INVITE_NOT_FOUND"
                  ? "That invite code doesn't exist."
                  : "That code isn't valid. Double-check and try again."

        setInviteError(message)
        return
      }

      // Valid! Store it and show checkmark
      setPendingInviteCode(trimmed)
      setInviteValid(true)
    } catch {
      setInviteError("We couldn't validate the code right now. Please try again.")
    } finally {
      setInviteChecking(false)
    }
  }

  // --- Step 2: Google Sign In ---
  const handleGoogleSignIn = async () => {
    setLoading(true)
    setError(null)

    try {
      const trimmed = inviteCode.trim()

      if (isSignup) {
        setAuthIntent("signup")

        if (!inviteValid) {
          setError("Please redeem your invite code first (Step 1).")
          return
        }

        setPendingInviteCode(trimmed)
      } else {
        setAuthIntent("login")

        // For login: if they validated an invite, store it so AuthCallback can redeem
        if (inviteValid && trimmed) {
          setPendingInviteCode(trimmed)
        }
      }

      const inviteParam = inviteValid && trimmed ? trimmed : null
      const callbackUrl = inviteParam
        ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}&invite=${encodeURIComponent(inviteParam)}`
        : `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`

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

  // For signup, Google button is disabled until invite is validated
  const googleDisabled = loading || (isSignup && !inviteValid)

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
            {!isSignup
              ? "Welcome back"
              : hasPendingInvite
                ? "Finalize access"
                : "Redeem your invite"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {!isSignup
              ? "Sign in to access your dashboard"
              : hasPendingInvite
                ? "Your invite is ready — redeem it and sign in"
                : "Enter your invite code to unlock Atlyr"}
          </p>
        </div>

        {/* Step 1: Invite Code */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            {isSignup && (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background text-xs font-bold">
                1
              </span>
            )}
            <span className="text-sm font-medium text-foreground">
              {isSignup 
                ? "Step 1: Redeem invite" 
                : "Redeem code (Skip if redeemed before)"}
            </span>
            {inviteValid && (
              <CheckCircle2 className="h-5 w-5 text-green-500 ml-auto" />
            )}
          </div>

          <form onSubmit={handleInviteCheck} className="space-y-2">
            <div className="flex gap-2">
              <Input
                value={inviteCode}
                onChange={(e) => {
                  setInviteCode(e.target.value)
                  setInviteError(null)
                  // Reset valid state when user types
                  if (inviteValid) setInviteValid(false)
                }}
                placeholder="Enter invite code"
                disabled={inviteChecking || inviteValid}
                className="h-10 flex-1 text-sm border-border bg-background"
              />
              {inviteValid ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 px-4 text-sm"
                  onClick={() => {
                    setInviteValid(false)
                    setInviteCode("")
                  }}
                >
                  Clear
                </Button>
              ) : (
                <Button
                  type="submit"
                  variant="outline"
                  disabled={inviteChecking || !inviteCode.trim()}
                  className="h-10 px-4 text-sm"
                >
                  {inviteChecking ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Redeem"
                  )}
                </Button>
              )}
            </div>
            {inviteError && (
              <p className="text-xs text-destructive">{inviteError}</p>
            )}
            {inviteValid && (
              <p className="text-xs text-green-600">
                {inviteValid ? "Invite redeemed! Proceed to sign in below." : ""}
              </p>
            )}
          </form>
        </div>

        {/* Separator */}
        <div className="relative my-5">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
        </div>

        {/* Step 2: Google Auth */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            {isSignup && (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background text-xs font-bold">
                2
              </span>
            )}
            <span className="text-sm font-medium text-foreground">
              {isSignup ? "Step 2: Sign in with Google" : "Sign in to your account"}
            </span>
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
            disabled={googleDisabled}
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

          {isSignup && !inviteValid && (
            <p className="mt-2 text-xs text-muted-foreground text-center">
              {hasPendingInvite
                ? "Verify your invite code above to continue"
                : "Enter and verify your invite code above to sign in"}
            </p>
          )}
        </div>

        {/* Sign Up / Login toggle link */}
        <div className="mt-6 text-center text-sm">
          {!isSignup ? (
            <>
              <span className="text-muted-foreground">New here? </span>
              <Link
                to={`/auth/signup?next=${encodeURIComponent(next)}`}
                className="text-foreground underline underline-offset-4 hover:text-foreground/80"
              >
                Redeem an invite code
              </Link>
            </>
          ) : (
            <>
              <span className="text-muted-foreground">Already have an account? </span>
              <Link
                to={`/auth/login?next=${encodeURIComponent(next)}`}
                className="text-foreground underline underline-offset-4 hover:text-foreground/80"
              >
                Sign in
              </Link>
            </>
          )}
        </div>
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
