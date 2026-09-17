import { motion } from "framer-motion"

import { WordmarkLockup } from "@/design-system/primitives"
import { InviteCodeEntry } from "./InviteCodeEntry"

type LandingGateProps = {
  isAuthenticated: boolean
  /** Scroll on down the page to the marketing sections and the waitlist form. */
  onWaitlistScroll: () => void
  onSignInClick: () => void
  onEnterApp: () => void
  /** Code from an invite link (`/?invite=CODE`), already normalized; null when absent. */
  inviteCode: string | null
}

/**
 * Canvas 6a — "the gate". The first viewport: the wordmark instead of any
 * headline, one terracotta action, and nothing else competing for the eye. The
 * marketing sections still scroll underneath.
 *
 * Two doors when signed out: the waitlist, and an invite code. A valid code is
 * stored and redeemed after Google returns (AuthCallback), which grants access via
 * has_app_access() alongside email approval. The canvas's "peek as a guest" link is
 * left out: signInAsGuest() has no routed caller.
 */
export function LandingGate({
  isAuthenticated,
  onWaitlistScroll,
  onSignInClick,
  onEnterApp,
  inviteCode,
}: LandingGateProps) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center px-8 text-center">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.7, 0, 0.2, 1] }}
        className="relative z-10 flex w-full max-w-[clamp(330px,38vw,520px)] flex-col items-center"
      >
        <WordmarkLockup size="landing" />

        <p className="mt-fluid-lg font-display text-fluid-h2 italic leading-[1.35] text-terracotta">
          Own the look
          <br />
          before you buy it.
        </p>

        <p className="mt-fluid-sm text-fluid-lg leading-[1.6] text-muted-foreground">
          Indie fusion, on your likeness.
          <br />
          By invitation, for now.
        </p>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={isAuthenticated ? onEnterApp : onWaitlistScroll}
          className="mt-fluid-lg w-full rounded-control bg-primary py-fluid-btn text-fluid-cta font-bold text-primary-foreground shadow-sm transition-shadow hover:shadow-md"
        >
          {isAuthenticated ? "Enter the studio →" : "Join the waitlist →"}
        </motion.button>

        {/* The page continues below the fold either way, so the way down must
            survive both branches — signed out it IS the primary action, signed
            in it would otherwise vanish behind "Enter the studio". */}
        {isAuthenticated ? (
          <button
            type="button"
            onClick={onWaitlistScroll}
            className="mt-fluid-sm text-fluid-md font-medium text-muted-foreground transition-colors hover:text-terracotta"
          >
            Take a look around <span className="text-terracotta">↓</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onSignInClick}
              className="mt-fluid-sm text-fluid-md font-medium text-muted-foreground transition-colors hover:text-terracotta"
            >
              Already invited? <span className="text-terracotta">Sign in →</span>
            </button>
            <InviteCodeEntry initialCode={inviteCode} />
          </>
        )}
      </motion.div>
    </div>
  )
}
