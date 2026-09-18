import { useEffect, useMemo } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { getAuthIntent, setAuthIntent } from "@/features/auth/authIntentStorage";
import { useHasAppAccessQuery } from "@/features/auth/hooks/useInviteAccess";
import { normalizeInviteCode } from "@/features/auth/inviteCode";
import { LandingHeader } from "./components/LandingHeader";
import { LandingScreen } from "./components/LandingScreen";
import { SectionCopy } from "./components/SectionCopy";
import { HeroPreview } from "./components/HeroPreview";
import { ShowcaseSection } from "./components/ShowcaseSection";
import { WaitlistSection } from "./components/WaitlistSection";
import { scrollToWaitlist } from "./scrollToWaitlist";

const STUDIO_COPY = ["irl *dress up* game. search by *vibes*", "personalise *inspiration*. curate *wardrobe*"];
const SHOWCASE_COPY = ["try-on the look on your *Likeness*", "we find the items for your *creation*"];

export default function LandingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  const accessQuery = useHasAppAccessQuery(Boolean(user?.id));

  // A session arriving here with the pre-login intent still set means Google returned to the site
  // root instead of the callback, so finish the sign-in where it belongs.
  useEffect(() => {
    if (user && getAuthIntent()) {
      navigate(`/auth/callback?next=${encodeURIComponent("/app")}`, { replace: true });
    }
  }, [navigate, user]);

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

  const inviteCode = useMemo(() => normalizeInviteCode(searchParams.get("invite")), [searchParams]);

  // Straight to Google, no interstitial; a new account is sent to the invite code page by the callback.
  const handleSignInClick = async () => {
    setAuthIntent("login");
    const { error } = await signInWithGoogle(`${window.location.origin}/auth/callback?next=${encodeURIComponent("/app")}`);
    if (error) toast({ title: "Could not start Google sign-in", description: "Please try again." });
  };

  // An invite link goes to the invite screen, which carries the code through Google.
  if (inviteCode) return <Navigate to={`/auth/invite?code=${encodeURIComponent(inviteCode)}`} replace />;
  // Nothing paints until the session and access are known, so a member never sees the landing flash by.
  if (authLoading || (user && accessQuery.isLoading)) return null;
  // A signed-in member goes straight into the app; the landing is for visitors and unapproved accounts.
  if (user && accessQuery.data && !getAuthIntent()) return <Navigate to="/app" replace />;

  return (
    // The shell is exactly the visible viewport: any document overflow would let iOS collapse its
    // toolbar mid-scroll, which resizes every full-height section under the finger.
    <div className="relative h-[100dvh] overflow-hidden bg-background">
      <div className="h-full overflow-y-scroll overscroll-y-none scroll-smooth snap-y snap-mandatory">
        <LandingHeader
          isAuthenticated={Boolean(user)}
          hasAccess={Boolean(accessQuery.data)}
          onWaitlistScroll={scrollToWaitlist}
          onSignInClick={() => void handleSignInClick()}
        />

        {/* The studio itself is the opener; the showcase screen repeats its exact layout. */}
        <LandingScreen>
          <SectionCopy lines={STUDIO_COPY} />
          <HeroPreview />
        </LandingScreen>

        <LandingScreen>
          <SectionCopy lines={SHOWCASE_COPY} />
          <ShowcaseSection />
        </LandingScreen>

        <section className="relative h-[100dvh] snap-start snap-always">
          <WaitlistSection utmParams={utmParams} onSignInClick={() => void handleSignInClick()} />
        </section>
      </div>
    </div>
  );
}
