import { useMemo, useState } from "react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { WordmarkLockup } from "@/design-system/primitives"
import { useAuth } from "@/contexts/AuthContext"
import { useHasAppAccessQuery, useRedeemInviteMutation } from "@/features/auth/hooks/useInviteAccess"
import { inviteErrorText } from "@/features/auth/inviteCode"
import { clearPendingInviteCode, clearReturningMarker, setReturningMarker } from "@/features/auth/inviteStorage"
import { authKeys } from "@/features/auth/queryKeys"

// Signed in, but not approved and no code redeemed yet. The one place a code can be
// redeemed after sign-in, so nobody is signed out into a dead end.
export function InviteCodePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { user, loading, signOut } = useAuth()
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

  const switchAccount = async () => {
    clearPendingInviteCode()
    clearReturningMarker()
    await signOut().catch(() => null)
    navigate("/auth/login", { replace: true })
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-ink px-6 py-12">
      <div className="relative z-10 w-full max-w-[clamp(330px,32vw,460px)]">
        <WordmarkLockup size="firstRun" onDark />

        <p className="mt-8 text-center text-fluid-sm font-semibold uppercase tracking-[0.22em] text-primary">
          By invitation
        </p>
        <h1 className="mt-[7px] text-center font-display text-fluid-h1 font-medium leading-[1.12] text-background">
          Enter your invite code.
        </h1>
        <p className="mt-4 text-center text-fluid-base leading-[1.6] text-on-ink-1">
          Signed in as <span className="font-medium text-background">{user.email}</span>.
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
            className="w-full rounded-control border border-on-ink-1/30 bg-transparent px-4 py-3 text-center font-mono text-fluid-md uppercase tracking-[0.12em] text-background outline-none focus:border-primary"
          />
          {error && (
            <p role="alert" className="rounded-control bg-destructive/15 px-3 py-2 text-center text-fluid-md text-destructive-foreground">
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={redeem.isPending || !code.trim()}
            className="h-auto w-full rounded-control bg-secondary py-fluid-btn text-fluid-cta font-bold text-foreground hover:bg-secondary/90"
          >
            {redeem.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Continue"}
          </Button>
        </form>

        <p className="mt-8 text-center text-fluid-xs2 leading-[1.8] text-on-ink-1/70">
          No code?{" "}
          <Link to="/?waitlist=1" className="underline underline-offset-2 hover:text-on-ink-2">
            Join the waitlist
          </Link>
          <br />
          <button type="button" onClick={switchAccount} className="underline underline-offset-2 hover:text-on-ink-2">
            Use a different account
          </button>
        </p>
      </div>
    </div>
  )
}

export default InviteCodePage
