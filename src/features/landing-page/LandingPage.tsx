import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { hasReturningMarker } from "@/features/auth/inviteStorage";
import { LandingHeader } from "./components/LandingHeader";
import { HeroSection } from "./components/HeroSection";
import { HeroPreview } from "./components/HeroPreview";
import { AISection } from "./components/AISection";
import { AboutSection } from "./components/AboutSection";
import { GallerySection } from "./components/GallerySection";
import { ShowcaseSection } from "./components/ShowcaseSection";
import { WaitlistSection } from "./components/WaitlistSection";
import { LandingFooter } from "./components/LandingFooter";
import { motion } from "framer-motion";

// Helper function to get CSS variable value as hex color
function getCSSVariableAsHex(variable: string): string {
  if (typeof window === "undefined") return "#000000";

  const root = document.documentElement;
  const value = getComputedStyle(root).getPropertyValue(variable).trim();

  if (!value) return "#000000";

  // If it's in HSL format (e.g., "12 6.4935% 15.0980%"), convert to hex
  if (value.includes(" ")) {
    const hslMatch = value.match(/(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/);
    if (hslMatch) {
      const h = parseFloat(hslMatch[1]);
      const s = parseFloat(hslMatch[2]) / 100;
      const l = parseFloat(hslMatch[3]) / 100;

      // Convert HSL to RGB
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
      const m = l - c / 2;

      let r = 0, g = 0, b = 0;

      if (h >= 0 && h < 60) {
        r = c; g = x; b = 0;
      } else if (h >= 60 && h < 120) {
        r = x; g = c; b = 0;
      } else if (h >= 120 && h < 180) {
        r = 0; g = c; b = x;
      } else if (h >= 180 && h < 240) {
        r = 0; g = x; b = c;
      } else if (h >= 240 && h < 300) {
        r = x; g = 0; b = c;
      } else if (h >= 300 && h < 360) {
        r = c; g = 0; b = x;
      }

      const rgb = {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255),
      };

      return `#${rgb.r.toString(16).padStart(2, "0")}${rgb.g.toString(16).padStart(2, "0")}${rgb.b.toString(16).padStart(2, "0")}`;
    }
  }

  return value;
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  const utmParams = useMemo(() => {
    const entries: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (key.startsWith("utm_")) {
        entries[key] = value;
      }
    });
    return entries;
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get("waitlist") === "1") {
      const formElement = document.getElementById("waitlist-form");
      formElement?.scrollIntoView({ behavior: "smooth" });
    }
  }, [searchParams]);

  useEffect(() => {
    if (authLoading) return;
    if (user) {
      navigate("/app", { replace: true });
      return;
    }
    if (searchParams.get("waitlist") === "1") {
      return;
    }
    if (hasReturningMarker()) {
      navigate(`/auth/login?next=${encodeURIComponent("/app")}`, { replace: true });
    }
  }, [authLoading, navigate, searchParams, user]);

  const isAuthenticated = Boolean(user);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const [isScrollable, setIsScrollable] = useState(false);

  // Switch overflow to scroll when the container hits the top of the viewport
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // When the sentinel leaves the viewport, the container has reached/passed the top
        setIsScrollable(!entry.isIntersecting);
      },
      {
        root: null,
        threshold: 0,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const handleWaitlistScroll = () => {
    document.getElementById("waitlist-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleSignInClick = () => {
    navigate(`/auth/login?next=${encodeURIComponent("/app")}`);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-background">
      <div
        ref={scrollContainerRef}
        className={`max-h-[100vh] overflow-y-scroll scroll-smooth snap-y snap-mandatory`}
      >
        {/* Header + Hero Title */}
        <section className="snap-start snap-always h-[300px] flex flex-col items-center justify-end">
          <LandingHeader
            isAuthenticated={isAuthenticated}
            onWaitlistScroll={handleWaitlistScroll}
            onSignInClick={handleSignInClick}
          />

          <div className="max-w-5xl mx-auto px-6 sm:px-8">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-6xl lowercase lg:text-5xl xl:text-6xl text-center ">
              Your personal
              <span className="block bg-foreground h-[60px] md:h-[80px] lg:h-[100px] bg-clip-text text-transparent font-thin" style={{ textTransform: 'lowercase', fontFamily: "'Pacifico', cursive" }}>
                fashion companion
              </span>
            </h1>
          </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleWaitlistScroll}
              className="relative mx-auto mt-4 overflow-hidden rounded-full bg-primary px-8 py-3 text-xs font-bold uppercase tracking-widest text-white shadow-sm transition-shadow hover:shadow-md"
            >
              Join Waitlist
            </motion.button>
        </section>

        {/* Hero Content */}
        <section className="relative isolate min-h-screen flex flex-col justify-center snap-start snap-always ">
          <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-1 px-6 pb-16 pt-8 sm:px-8 lg:gap-16 lg:pb-20">
            <HeroSection />
            <HeroPreview />
          </div>
        </section>

        {/* Showcase Section */}
        <section className="relative snap-start snap-always">
          <ShowcaseSection />
          <div className="absolute bottom-0 left-1/2 h-px w-48 -translate-x-1/2 bg-gradient-to-r from-transparent via-border/50 to-transparent"></div>
        </section>

        {/* AI Section
        <section className="relative">
          <AISection />
          <div className="absolute bottom-0 left-1/2 h-px w-48 -translate-x-1/2 bg-gradient-to-r from-transparent via-border/50 to-transparent"></div>
        </section> */}

        {/* About Section */}
        {/* <section className="relative">
          <AboutSection />
          <div className="absolute bottom-0 left-1/2 h-px w-48 -translate-x-1/2 bg-gradient-to-r from-transparent via-border/50 to-transparent"></div>
        </section> */}

        {/* Gallery Section */}
        {/* <section className="relative">
          <GallerySection />
          <div className="absolute bottom-0 left-1/2 h-px w-48 -translate-x-1/2 bg-gradient-to-r from-transparent via-border/50 to-transparent"></div>
        </section> */}

        {/* Showcase Section */}
        {/* <section className="relative">
          <ShowcaseSection />
          <div className="absolute bottom-0 left-1/2 h-px w-48 -translate-x-1/2 bg-gradient-to-r from-transparent via-border/50 to-transparent"></div>
        </section> */}

        {/* Waitlist Section */}
        <section className="relative py-2 sm:py-18 pb-0 lg:py-0 lg:pb-0 snap-start snap-always ">
            <WaitlistSection utmParams={utmParams} onSignInClick={handleSignInClick} />
        </section>

        {/* Footer */}
        {/* <footer className="relative mt-16 border-t border-border/50 snap-start snap-always">
          <LandingFooter />
        </footer> */}
      </div>
    </div>
  );
}

