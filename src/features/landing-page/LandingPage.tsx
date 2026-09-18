import { useEffect, useMemo } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { getAuthIntent, setAuthIntent } from "@/features/auth/authIntentStorage";
import { useHasAppAccessQuery } from "@/features/auth/hooks/useInviteAccess";
import { normalizeInviteCode } from "@/features/auth/inviteCode";
import { setPendingInviteCode } from "@/features/auth/inviteStorage";
import { LandingHeader } from "./components/LandingHeader";
import { HeroSection } from "./components/HeroSection";
import { HeroPreview } from "./components/HeroPreview";
import { ShowcaseSection } from "./components/ShowcaseSection";
import { WaitlistSection } from "./components/WaitlistSection";
import { scrollToWaitlist } from "./scrollToWaitlist";

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

  // An invite link parks its code here; the auth callback redeems it once Google returns.
  useEffect(() => {
    if (!inviteCode) return;
    setPendingInviteCode(inviteCode);
    toast({ title: "Invite ready", description: "Log in with Google to use it." });
  }, [inviteCode, toast]);

  // Straight to Google, no interstitial; a new account is sent to the invite code page by the callback.
  const handleSignInClick = async () => {
    setAuthIntent(inviteCode ? "signup" : "login");
    const { error } = await signInWithGoogle(`${window.location.origin}/auth/callback?next=${encodeURIComponent("/app")}`);
    if (error) toast({ title: "Could not start Google sign-in", description: "Please try again." });
  };

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
          <WaitlistSection utmParams={utmParams} onSignInClick={() => void handleSignInClick()} />
        </section>
      </div>
    </div>
  );
}
