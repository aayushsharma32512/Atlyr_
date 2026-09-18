import { useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { LandingHeader } from "./components/LandingHeader";
import { HeroSection } from "./components/HeroSection";
import { HeroPreview } from "./components/HeroPreview";
import { ShowcaseSection } from "./components/ShowcaseSection";
import { WaitlistSection } from "./components/WaitlistSection";
import { scrollToWaitlist } from "./scrollToWaitlist";

export default function LandingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Not awaited: the page is the same for everyone, only the header button changes once a session resolves.
  const { user } = useAuth();

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
      scrollToWaitlist();
    }
  }, [searchParams]);

  const handleSignInClick = () => {
    navigate(`/auth/login?next=${encodeURIComponent("/app")}`);
  };

  return (
    <div className="relative min-h-screen bg-background">
      <div className="h-[100dvh] overflow-y-scroll scroll-smooth snap-y snap-mandatory">
        <LandingHeader
          isAuthenticated={Boolean(user)}
          onWaitlistScroll={scrollToWaitlist}
          onSignInClick={handleSignInClick}
        />

        {/* The studio itself is the opener: two lines of copy under the fixed header, the frame takes the rest. */}
        <section className="relative isolate flex h-[100dvh] flex-col snap-start snap-always">
          <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col items-center px-4 pb-3 pt-[72px] sm:px-8">
            <HeroSection />
            <HeroPreview />
          </div>
        </section>

        <section className="relative snap-start snap-always">
          <ShowcaseSection />
          <div className="absolute bottom-0 left-1/2 h-px w-48 -translate-x-1/2 bg-gradient-to-r from-transparent via-border/50 to-transparent"></div>
        </section>

        <section className="relative h-[100dvh] snap-start snap-always">
          <WaitlistSection utmParams={utmParams} onSignInClick={handleSignInClick} />
        </section>
      </div>
    </div>
  );
}
