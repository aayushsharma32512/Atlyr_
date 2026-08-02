import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { WordmarkLockup } from "@/design-system/primitives";

type LandingHeaderProps = {
  isAuthenticated: boolean;
  onWaitlistScroll: () => void;
  onSignInClick: () => void;
};

export function LandingHeader({ isAuthenticated, onWaitlistScroll, onSignInClick }: LandingHeaderProps) {
  const navigate = useNavigate();

  return (
    <motion.header
      initial={{ y: "-100%" }}
      animate={{ y: 0 }}
      transition={{ type: "spring", stiffness: 100, damping: 20 }}
      className={cn(
        "fixed top-0 left-0 right-0 z-50 flex h-16 items-center justify-between px-6 transition-all duration-300 md:px-12",
        "bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/80",
        "border-b border-hairline"
      )}
    >

      <div className="flex items-center justify-between max-w-7xl mx-auto w-full">
        {/* Left: the mark. Small here — the gate below carries the full lockup. */}
        <div className="flex items-center">
          <Link
            to="/"
            className="group"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <WordmarkLockup
              size="header"
              className="transition-opacity duration-300 group-hover:opacity-70"
            />
          </Link>
        </div>

        {/* Right: Actions. Outlined, not filled — the gate's CTA is the screen's
            one terracotta and this must not compete with it.

            The label carries its own clamp instead of a --fluid-* step: 10px
            falls between --fluid-xs and --fluid-sm, and snapping to either
            would resize the mobile header off the spec. */}
        <div className="flex items-center gap-6">
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={isAuthenticated ? () => navigate('/app') : onSignInClick}
            className="rounded-[3px] border border-foreground px-6 py-2.5 text-[clamp(0.625rem,0.24vw+0.567rem,0.813rem)] font-bold uppercase tracking-[0.14em] text-foreground transition-colors hover:bg-foreground hover:text-background"
          >
            {isAuthenticated ? "Enter app" : "Log in"}
          </motion.button>
        </div>
      </div>
    </motion.header>
  );
}

