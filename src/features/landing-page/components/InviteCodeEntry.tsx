import { useState } from "react"
import { Loader2 } from "lucide-react"

import { useAuth } from "@/contexts/AuthContext"
import { setAuthIntent } from "@/features/auth/authIntentStorage"
import { useValidateInviteMutation } from "@/features/auth/hooks/useInviteAccess"
import { inviteErrorText } from "@/features/auth/inviteCode"
import { setPendingInviteCode } from "@/features/auth/inviteStorage"

type InviteCodeEntryProps = {
  /** Pre-filled from an invite link (`/?invite=CODE`); opens the field at once. */
  initialCode: string | null
}

// The code is only checked here; it is redeemed after Google returns, in AuthCallback.
export function InviteCodeEntry({ initialCode }: InviteCodeEntryProps) {
  const [open, setOpen] = useState(Boolean(initialCode))
  const [code, setCode] = useState(initialCode ?? "")
  const [error, setError] = useState<string | null>(null)
  const [redirecting, setRedirecting] = useState(false)
  const validate = useValidateInviteMutation()
  const { signInWithGoogle } = useAuth()

  const busy = validate.isPending || redirecting

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const result = await validate.mutateAsync(code)
      if (!result.valid) {
        setError(inviteErrorText(result.error))
        return
      }
      setPendingInviteCode(code)
      setAuthIntent("signup")
      setRedirecting(true)
      const callbackUrl = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/app")}`
      const { error: signInError } = await signInWithGoogle(callbackUrl)
      if (signInError) {
        setRedirecting(false)
        setError("Couldn't start Google sign-in. Please try again.")
      }
    } catch {
      setError(inviteErrorText(null))
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-fluid-xs text-fluid-md font-medium text-muted-foreground transition-colors hover:text-terracotta"
      >
        Have an invite code?
      </button>
    )
  }

  return (
    <form onSubmit={onSubmit} className="mt-fluid-sm flex w-full flex-col items-stretch gap-2">
      <input
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="ATLYR-XXXXXX"
        autoComplete="off"
        spellCheck={false}
        aria-label="Invite code"
        aria-invalid={Boolean(error)}
        className="w-full rounded-control border border-border bg-background px-4 py-3 text-center font-mono text-fluid-md uppercase tracking-[0.12em] text-foreground outline-none focus:border-terracotta"
      />
      {error && <p role="alert" className="text-center text-fluid-sm text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={busy || !code.trim()}
        className="w-full rounded-control bg-foreground py-fluid-btn text-fluid-cta font-bold text-background transition-opacity disabled:opacity-50"
      >
        {busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "Continue with Google"}
      </button>
    </form>
  )
}
