import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import logoImage from "/assets/logo.png";

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
        "bg-white/80 backdrop-blur-xl supports-[backdrop-filter]:bg-white/80",
        "border-b border-black/5 "
      )}
    >

      <div className="flex items-center justify-between max-w-7xl mx-auto w-full">
        {/* Left: Logo */}
        <div className="flex items-center">
          <Link
            to="/"
            className="group"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <img
              src={logoImage}
              alt="ATLYR"
              className="h-12 w-auto transition-opacity duration-300 group-hover:opacity-80"
            />
          </Link>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-6">
          {/* Optional: Keep 'Waitlist' as a subtle link if not authenticated */}


          {/* Hero Element: Log In Button */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={isAuthenticated ? () => navigate('/app') : onSignInClick}
            className="relative overflow-hidden rounded-full bg-foreground px-8 py-3 text-xs font-bold uppercase tracking-widest text-white shadow-sm transition-shadow hover:shadow-md"
          >
            {isAuthenticated ? "Enter App" : "Log In"}
          </motion.button>
        </div>
      </div>
    </motion.header>
  );
}

