import { motion } from "framer-motion"

import { WordmarkLockup } from "@/design-system/primitives"

type LandingGateProps = {
  isAuthenticated: boolean
  /** Scroll on down the page to the marketing sections and the waitlist form. */
  onWaitlistScroll: () => void
  onSignInClick: () => void
  onEnterApp: () => void
}

/**
 * Canvas 6a — "the gate". The first viewport: the wordmark instead of any
 * headline, one terracotta action, and nothing else competing for the eye. The
 * marketing sections still scroll underneath.
 *
 * The canvas also draws an invite-code field and a "peek as a guest" link and
 * annotates them as shipping. Neither is reachable in the app: WaitlistSection
 * carries the whole invite apparatus but never renders the input, and the only
 * caller of signInAsGuest() is AuthScreen, which has no route. Access is granted
 * by email approval (has_app_access(), checked in AuthCallback), not by code. So
 * both are left out rather than shipped as decoration — the waitlist is the real
 * front door, and "already invited" goes to the door that actually opens.
 */
export function LandingGate({
  isAuthenticated,
  onWaitlistScroll,
  onSignInClick,
  onEnterApp,
}: LandingGateProps) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center px-8 text-center">
      <div className="bg-warp-grid pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.7, 0, 0.2, 1] }}
        className="relative z-10 flex w-full max-w-[330px] flex-col items-center"
      >
        <WordmarkLockup size="landing" />

        <p className="mt-9 font-display text-[19px] italic leading-[1.35] text-terracotta">
          Own the look
          <br />
          before you buy it.
        </p>

        <p className="mt-4 text-[11.5px] leading-[1.6] text-muted-foreground">
          Indie fusion, on your likeness.
          <br />
          By invitation, for now.
        </p>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={isAuthenticated ? onEnterApp : onWaitlistScroll}
          className="mt-9 w-full rounded-[3px] bg-primary py-[15px] text-[13px] font-bold text-primary-foreground shadow-sm transition-shadow hover:shadow-md"
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
            className="mt-4 text-[11px] font-medium text-muted-foreground transition-colors hover:text-terracotta"
          >
            Take a look around <span className="text-terracotta">↓</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onSignInClick}
            className="mt-4 text-[11px] font-medium text-muted-foreground transition-colors hover:text-terracotta"
          >
            Already invited? <span className="text-terracotta">Sign in →</span>
          </button>
        )}
      </motion.div>
    </div>
  )
}
