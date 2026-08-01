import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { GuestProvider, useGuest } from "@/contexts/GuestContext";
import { ProfileProvider, useProfileContext } from "@/features/profile/providers/ProfileProvider";
import { CollectionsPrefetcher } from "@/features/collections/providers/CollectionsPrefetcher";
import { JobsProvider } from "@/features/progress/providers/JobsContext";
import { FloatingProgressHub } from "@/features/progress/components/FloatingProgressHub";
import { LikenessDrawerHost } from "@/features/likeness/LikenessDrawerHost";
import { PostHogIdentitySync } from "@/integrations/posthog/PostHogIdentitySync";
import { PostHogRouteSync } from "@/integrations/posthog/PostHogRouteSync";
import { EngagementAnalyticsProvider } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsProvider";
import { isDesignPreviewPath, useSurfaceTheme } from "@/hooks/useSurfaceTheme";
import { needsFirstRun } from "@/features/profile/constants/firstRun";
import { Suspense, lazy, type ReactNode } from "react";
// Simple loading component
const LoadingSpinner = () => (
  <div className="flex items-center justify-center h-screen">
    <div className="animate-spin rounded-full border-2 border-muted border-t-primary w-8 h-8" />
  </div>
);
import { ErrorBoundary } from "@/components/ui/error-boundary";

// Lazy load components for code splitting
const LandingPage = lazy(() => import("./pages/Landing.tsx"));
const AppRouter = lazy(() => import("./pages/AppRouter.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const InventoryDashboard = lazy(() => import("@/components/hitl/InventoryDashboard"));
const DesignSystemPreview = lazy(() => import("./pages/DesignSystemPreview.tsx"));
const StudioRedesign = lazy(() => import("./pages/studio/index.tsx"));
const ProductPagePreview = lazy(() => import("./pages/ProductPagePreview.tsx"));
const SimilarItemsPreview = lazy(() => import("./pages/SimilarItemsPreview.tsx"));
const HomePreview = lazy(() => import("./pages/HomePreview.tsx"));
const SearchPreview = lazy(() => import("./pages/SearchPreview.tsx"));
const CollectionsPreview = lazy(() => import("./pages/CollectionsPreview.tsx"));
const MannequinPreview = lazy(() => import("./pages/MannequinPreview.tsx"));
const Profile = lazy(() => import("./pages/Profile.tsx"));
const AdminInvites = lazy(() => import("./pages/AdminInvites.tsx"));
const AdminStudioRoutes = lazy(() => import("./pages/admin/studio/index.tsx"));
const EnrichmentReviewDashboard = lazy(() => import("./pages/admin/EnrichmentReviewDashboard.tsx"));
const IngestionV2Dashboard = lazy(() => import("./pages/admin/IngestionV2Dashboard.tsx"));
const IngestionAutomatedDashboard = lazy(() => import("./pages/admin/IngestionAutomatedDashboard.tsx"));
const PlacementDashboard = lazy(() => import("./pages/admin/PlacementDashboard.tsx"));
const AvatarPreview = lazy(() => import("./pages/AvatarPreview.tsx"));
const UserDetailsPreview = lazy(() => import("./pages/UserDetailsPreview.tsx"));
const TastePage = lazy(() => import("@/features/profile/pages/TastePage"));
const FigurePreview = lazy(() => import("./pages/FigurePreview.tsx"));
const AdminHome = lazy(() => import("./pages/admin/AdminHome.tsx"));
const LoginPage = lazy(() => import("./pages/LoginPage.tsx"));
const AuthCallback = lazy(() => import("./pages/AuthCallback.tsx"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes (replaces cacheTime)
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
  },
});

function ShareAccessGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { guestState } = useGuest();
  const location = useLocation();

  if (loading) {
    return null;
  }

  const isStudioPath = location.pathname.startsWith("/studio");
  const shareParam = new URLSearchParams(location.search).get("share") === "1";
  const isAuthenticated = Boolean(user) && !guestState.isGuest;

  if (isAuthenticated) {
    return <>{children}</>;
  }

  if (isStudioPath && shareParam) {
    return <>{children}</>;
  }

  return <Navigate to="/?waitlist=1" replace />;
}

function AdminAccessGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { guestState } = useGuest();
  const { role, isLoading: isProfileLoading } = useProfileContext();
  const location = useLocation();

  if (loading || isProfileLoading) {
    return null;
  }

  const isAuthenticated = Boolean(user) && !guestState.isGuest;
  
  // Must be authenticated
  if (!isAuthenticated) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/auth/login?next=${next}`} replace />;
  }

  // Must be admin
  if (role !== 'admin') {
    return <Navigate to="/home" replace />;
  }

  return <>{children}</>;
}

/**
 * Applies `data-surface` to <html> so /admin and /hitl keep the pre-Kalagriha
 * stone theme while the rest of the app uses the Tantu palette. Renders
 * nothing; must live inside BrowserRouter.
 */
function SurfaceTheme() {
  useSurfaceTheme();
  return null;
}

// Component to conditionally show FloatingProgressHub only for authenticated users
function AuthenticatedProgressHub() {
  const { user, loading } = useAuth();
  const { guestState } = useGuest();
  const location = useLocation();

  const { profile } = useProfileContext();

  // Don't show on public pages
  const publicPaths = ['/', '/waitlist', '/landing', '/marketing', '/auth/login', '/auth/signup', '/auth/callback'];
  const isPublicPath = publicPaths.includes(location.pathname);

  // Only show for authenticated (non-guest) users on non-public paths
  const isAuthenticated = Boolean(user) && !guestState.isGuest;

  // Not during first run, and not over a design-system preview. The hub is a
  // floating panel anchored bottom-left; on the onboarding screens it lands on
  // top of the primary CTA, and there is nothing to report anyway — you can't
  // have a generation in flight before you've finished signing up.
  const isSuppressedSurface =
    needsFirstRun(profile) ||
    location.pathname.startsWith('/design-system') ||
    isDesignPreviewPath(location.pathname);

  if (loading || isPublicPath || !isAuthenticated || isSuppressedSurface) {
    return null;
  }

  return <FloatingProgressHub />;
}

// Loading component for suspense fallback
const PageLoader = () => (
  <div className="flex items-center justify-center h-screen">
    <LoadingSpinner />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <GuestProvider>
        <ProfileProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <EngagementAnalyticsProvider>
                <JobsProvider>
                  <SurfaceTheme />
                  <CollectionsPrefetcher />
                  <PostHogIdentitySync />
                  <AuthenticatedProgressHub />
                  <LikenessDrawerHost />
                  <PostHogRouteSync enableSessionReplay />
                  <ErrorBoundary>
                    <Suspense fallback={<PageLoader />}>
                      <Routes>
                    <Route path="/" element={<LandingPage />} />
                    <Route path="/waitlist" element={<LandingPage />} />
                    <Route path="/landing" element={<LandingPage />} />
                    <Route path="/marketing" element={<LandingPage />} />
                    <Route path="/auth/login" element={<LoginPage />} />
                    <Route path="/auth/signup" element={<LoginPage />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />
                    <Route path="/app/*" element={<AppRouter />} />
                    <Route
                      path="/product/:itemId"
                      element={
                        <ShareAccessGuard>
                          <AppRouter />
                        </ShareAccessGuard>
                      }
                    />
                    <Route
                      path="/checkout/:outfitId"
                      element={
                        <ShareAccessGuard>
                          <AppRouter />
                        </ShareAccessGuard>
                      }
                    />
                    <Route path="/hitl" element={<InventoryDashboard />} />
                    <Route
                      path="/home"
                      element={
                        <ShareAccessGuard>
                          <HomePreview />
                        </ShareAccessGuard>
                      }
                    />
                    <Route
                      path="/search"
                      element={
                        <ShareAccessGuard>
                          <SearchPreview />
                        </ShareAccessGuard>
                      }
                    />
                    <Route
                      path="/profile"
                      element={
                        <ShareAccessGuard>
                          <Profile />
                        </ShareAccessGuard>
                      }
                    />
                    <Route
                      path="/profile/avatar"
                      element={
                        <ShareAccessGuard>
                          <AvatarPreview />
                        </ShareAccessGuard>
                      }
                    />
                    <Route
                      path="/profile/user-details"
                      element={
                        <ShareAccessGuard>
                          <UserDetailsPreview />
                        </ShareAccessGuard>
                      }
                    />
                    {/* First run, step 1 of 2 — taste (6c). Step 2 is the
                        figure at /profile/user-details (6c2). */}
                    <Route
                      path="/onboarding/taste"
                      element={
                        <ShareAccessGuard>
                          <TastePage />
                        </ShareAccessGuard>
                      }
                    />
                    {/* The admin index. React Router ranks by specificity, not
                        declaration order, so an exact "/admin" does not shadow
                        the nested admin routes below. */}
                    <Route
                      path="/admin"
                      element={
                        <AdminAccessGuard>
                          <AdminHome />
                        </AdminAccessGuard>
                      }
                    />
                    <Route
                      path="/admin/invites"
                      element={
                        <AdminAccessGuard>
                          <AdminInvites />
                        </AdminAccessGuard>
                      }
                    />
                    <Route
                      path="/admin/studio/*"
                      element={
                        <AdminAccessGuard>
                          <AdminStudioRoutes />
                        </AdminAccessGuard>
                      }
                    />
                    <Route
                      path="/admin/enrichment"
                      element={
                        <AdminAccessGuard>
                          <EnrichmentReviewDashboard />
                        </AdminAccessGuard>
                      }
                    />
                    <Route
                      path="/admin/ingestion-v2"
                      element={
                        <AdminAccessGuard>
                          <IngestionV2Dashboard />
                        </AdminAccessGuard>
                      }
                    />
                    <Route
                      path="/admin/ingestion-automated"
                      element={
                        <AdminAccessGuard>
                          <IngestionAutomatedDashboard />
                        </AdminAccessGuard>
                      }
                    />
                    <Route
                      path="/admin/placement"
                      element={
                        <AdminAccessGuard>
                          <PlacementDashboard />
                        </AdminAccessGuard>
                      }
                    />
                    <Route
                      path="/studio/*"
                      element={
                        <ShareAccessGuard>
                          <StudioRedesign />
                        </ShareAccessGuard>
                      }
                    />
                    <Route path="/design-system/product-card" element={<DesignSystemPreview />} />
                    {/* Previews of the first-run screens, so the onboarding chrome
                        can be reviewed without flipping profiles.onboarding_complete.
                        Admin-only — unlike the older /design-system/* routes these
                        render real profile data. Under /admin so the guard and the
                        URL agree; useSurfaceTheme exempts them from the ops palette
                        so they still preview in the app's own register. */}
                    <Route
                      path="/admin/design-system/figure"
                      element={
                        <AdminAccessGuard>
                          <FigurePreview />
                        </AdminAccessGuard>
                      }
                    />
                    <Route
                      path="/admin/design-system/taste"
                      element={
                        <AdminAccessGuard>
                          <TastePage />
                        </AdminAccessGuard>
                      }
                    />
                    <Route path="/design-system/studio/*" element={<Navigate to="/studio" replace />} />
                    <Route
                      path="/design-system/studio-alternatives" 
                      element={<Navigate to="/studio/alternatives" replace />}
                    />
                    <Route
                      path="/design-system/studio-scroll-up"
                      element={<Navigate to="/studio/scroll-up" replace />}
                    />
                    <Route
                      path="/design-system/product-page"
                      element={<ProductPagePreview />}
                    />
                    <Route
                      path="/design-system/similar-items"
                      element={<SimilarItemsPreview />}
                    />
                    <Route
                      path="/design-system/home"
                      element={
                        <ShareAccessGuard>
                          <HomePreview />
                        </ShareAccessGuard>
                      }
                    />
                    <Route
                      path="/design-system/search"
                      element={
                        <ShareAccessGuard>
                          <SearchPreview />
                        </ShareAccessGuard>
                      }
                    />
                    <Route
                      path="/collection"
                      element={
                        <ShareAccessGuard>
                          <CollectionsPreview />
                        </ShareAccessGuard>
                      }
                    />
                    <Route path="/design-system/collection" element={<Navigate to="/collection" replace />} />
                    <Route path="/design-system/mannequin" element={<MannequinPreview />} />
                    <Route path="/mannequin" element={<MannequinPreview />} />
                    <Route
                      path="/design-system/profile"
                      element={
                        <ShareAccessGuard>
                          <Profile />
                        </ShareAccessGuard>
                      }
                    />
                    <Route path="*" element={<NotFound />} />
                      </Routes>
                    </Suspense>
                  </ErrorBoundary>
                </JobsProvider>
              </EngagementAnalyticsProvider>
            </BrowserRouter>
          </TooltipProvider>
        </ProfileProvider>
      </GuestProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
