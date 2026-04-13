import { useState, useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { HomePage } from '@/components/home/HomePage';
import { StudioPage } from '@/components/studio/StudioPage';
import { SearchScreen } from '@/components/search/SearchScreen';
import { CollectionsScreen } from '@/components/collections/CollectionsScreen';
import { ProfileScreen } from '@/components/profile/ProfileScreen';
import { CheckoutScreen } from '@/components/checkout/CheckoutScreen';
import { ProductDetailScreen } from '@/components/product/ProductDetailScreen';
import { BottomNavigation } from '@/components/layout/BottomNavigation';
import { PageLayout } from '@/components/layout/PageLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useGuest } from '@/contexts/GuestContext';
import { GuestAvatarModal } from '@/components/profile/GuestAvatarModal';
import { useProfileContext } from '@/features/profile/providers/ProfileProvider';
import { Outfit } from '@/types';
import { Loader2 } from 'lucide-react';
import { useSessionTracking } from '@/hooks/useSessionTracking';
import { useStudioSession } from '@/hooks/useStudioSession';

type AppView = 'home' | 'studio' | 'collections' | 'search' | 'profile';

export default function Index() {
  const { user, loading: authLoading } = useAuth();
  const { guestState } = useGuest();
  const { profile, isLoading: profileLoading } = useProfileContext();
  const { session, saveSession, clearSession, hasSession } = useStudioSession();
  const [currentView, setCurrentView] = useState<AppView>('home');
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [selectedOutfit, setSelectedOutfit] = useState<Outfit | null>(null);
  const scrollPositionsRef = useRef<Record<AppView, number>>({
    home: 0,
    studio: 0,
    collections: 0,
    search: 0,
    profile: 0,
  });
  const previousViewRef = useRef<AppView>('home');

  useEffect(() => {
    const previousView = previousViewRef.current;
    if (previousView === 'home' && currentView !== 'home') {
      scrollPositionsRef.current.home = window.scrollY;
    }
    if (currentView === 'home') {
      const target = scrollPositionsRef.current.home || 0;
      requestAnimationFrame(() => {
        window.scrollTo({ top: target, behavior: 'auto' });
      });
    }
    previousViewRef.current = currentView;
  }, [currentView]);

  // Save session whenever studio state changes
  useEffect(() => {
    if (currentView === 'studio' && selectedOutfit) {
      // Preserve the original outfit from session or use the current outfit as fallback
      const originalOutfit = session?.originalOutfit || selectedOutfit;
      saveSession(selectedOutfit, selectedOutfit, originalOutfit, selectedOutfit.backgroundId);
    }
  }, [currentView, selectedOutfit, saveSession, session?.originalOutfit]); // Added session?.originalOutfit to dependencies
  const location = useLocation();
  const { enterStudio, exitStudio, getSessionStats } = useSessionTracking();
  
  // Log app session on page unload - MUST be at top level
  useEffect(() => {
    const handleBeforeUnload = () => {
      const stats = getSessionStats();
      // Log final app session stats
      console.log('📊 FINAL SESSION STATS:', {
        totalAppTime: Math.round(stats.totalAppTime / 1000), // Convert to seconds
        totalStudioTime: Math.round(stats.totalStudioTime / 1000),
        studioPercentage: Math.round(stats.studioPercentage * 100) / 100
      });
      // Clear studio session on page unload
      clearSession();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [clearSession, getSessionStats]);
  
  // Handle routing
  const isCheckoutRoute = location.pathname.includes('/checkout/');
  const isProductRoute = location.pathname.includes('/product/');

  // Listen for custom event to navigate to studio from ProductDetailScreen
  useEffect(() => {
    const handleNavigateToStudio = (event: CustomEvent) => {
      const { outfit } = event.detail;
      if (outfit) {
        setSelectedOutfit(outfit);
        setCurrentView('studio');
        // Save new session when selecting outfit
        saveSession(outfit, outfit, outfit, outfit.backgroundId);
        // Track studio entry
        enterStudio(outfit.id, outfit.category);
      }
    };

    window.addEventListener('navigateToStudio', handleNavigateToStudio as EventListener);
    const handleNavigateToCollections = () => { setCurrentView('collections') }
    const handleNavigateToHome = () => { setCurrentView('home') }
    const handleOverlayOpen = () => setIsOverlayOpen(true)
    const handleOverlayClose = () => setIsOverlayOpen(false)
    window.addEventListener('navigateToCollections', handleNavigateToCollections as EventListener)
    window.addEventListener('navigateToHome', handleNavigateToHome as EventListener)
    window.addEventListener('ui:overlay-open', handleOverlayOpen as EventListener)
    window.addEventListener('ui:overlay-close', handleOverlayClose as EventListener)
    return () => {
      window.removeEventListener('navigateToStudio', handleNavigateToStudio as EventListener);
      window.removeEventListener('navigateToCollections', handleNavigateToCollections as EventListener)
      window.removeEventListener('navigateToHome', handleNavigateToHome as EventListener)
      window.removeEventListener('ui:overlay-open', handleOverlayOpen as EventListener)
      window.removeEventListener('ui:overlay-close', handleOverlayClose as EventListener)
    };
  }, [saveSession, enterStudio]);
  
  const handleOutfitSelect = (outfit: Outfit) => {
    // Removed outfit_click logging - studio_open will handle this interaction
    setSelectedOutfit(outfit);
    setCurrentView('studio');
    // Save new session when selecting outfit
    saveSession(outfit, outfit, outfit, outfit.backgroundId); // This is correct - first time selection
    // Track studio entry
    enterStudio(outfit.id, outfit.category);
  };

  const handleBackToHome = () => {
    // Track studio exit
    if (selectedOutfit) {
      exitStudio(selectedOutfit.category);
      // Save session before leaving studio
      const originalOutfit = session?.originalOutfit || selectedOutfit;
      saveSession(selectedOutfit, selectedOutfit, originalOutfit, selectedOutfit.backgroundId);
    }
    setCurrentView('home');
    setSelectedOutfit(null);
  };

  const handleTabChange = (tab: string) => {
    // Track studio exit if leaving studio
    if (currentView === 'studio' && tab !== 'studio' && selectedOutfit) {
      exitStudio(selectedOutfit.category);
    }
    
    // Handle studio navigation
    if (tab === 'studio') {
      if (hasSession()) {
        // Restore session
        setSelectedOutfit(session?.currentOutfit || null);
        setCurrentView('studio');
      } else if (selectedOutfit) {
        // If we have a selected outfit but no session, save it
        saveSession(selectedOutfit, selectedOutfit, selectedOutfit, selectedOutfit.backgroundId); // This is correct - no session exists
        setCurrentView('studio');
      } else {
        // No session and no selected outfit, don't change view
        return;
      }
    } else {
      // Navigating to other tabs
      setCurrentView(tab as AppView);
      if (tab !== 'studio') {
        setSelectedOutfit(null);
        // Don't clear session when navigating away - keep it for restoration
      }
    }
  };

  // Show loading spinner while auth is initializing
  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Check if user is authenticated or is a guest
  const isAuthenticated = user || guestState.isGuest;

  // Show auth screen if not authenticated and not a guest, or on auth route
  if (!isAuthenticated) {
    return <Navigate to="/?waitlist=1" replace />;
  }

  // For guests, skip profile loading and onboarding
  if (guestState.isGuest) {
    if (isCheckoutRoute) {
      return (
        <div className="h-screen flex flex-col bg-background">
          <CheckoutScreen />
        </div>
      );
    }

    if (isProductRoute) {
      return (
        <div className="h-screen flex flex-col bg-background">
          <ProductDetailScreen />
        </div>
      );
    }

    return (
      <div className="h-screen flex flex-col bg-background">
        <PageLayout>
          <GuestAvatarPrompt />
          {(selectedOutfit || (currentView === 'studio' && session?.currentOutfit)) && session?.currentOutfit && (
            <div style={{ display: currentView === 'studio' ? 'block' : 'none' }}>
              <StudioPage 
                outfit={selectedOutfit || session.currentOutfit} 
                onBack={handleBackToHome}
                onOutfitChange={(updatedOutfit) => {
                  setSelectedOutfit(updatedOutfit);
                  // Preserve the original outfit from session or use the current outfit as fallback
                  const originalOutfit = session?.originalOutfit || updatedOutfit;
                  saveSession(updatedOutfit, updatedOutfit, originalOutfit, updatedOutfit.backgroundId);
                }}
              />
            </div>
          )}
          <div style={{ display: currentView === 'home' ? 'block' : 'none' }}>
            <HomePage onOutfitSelect={handleOutfitSelect} />
          </div>
          <div style={{ display: currentView === 'collections' ? 'block' : 'none' }}>
            <CollectionsScreen />
          </div>
          <div style={{ display: currentView === 'search' ? 'block' : 'none' }}>
            <SearchScreen onOutfitSelect={handleOutfitSelect} />
          </div>
          <div style={{ display: currentView === 'profile' ? 'block' : 'none' }}>
            <ProfileScreen />
          </div>
        </PageLayout>
        
        {!isOverlayOpen && (
          <BottomNavigation 
            activeTab={currentView} 
            onTabChange={handleTabChange}
          />
        )}
      </div>
    );
  }

  // For authenticated users, continue with normal flow
  // Show loading while profile is loading
  if (profileLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Redirect to new onboarding flow if profile doesn't exist or onboarding not complete
  if (!profile || !profile.onboarding_complete) {
    return <Navigate to="/profile/user-details" replace />;
  }

  if (isCheckoutRoute) {
    return (
      <div className="h-screen flex flex-col bg-background">
        <CheckoutScreen />
      </div>
    );
  }

  if (isProductRoute) {
    return (
      <div className="h-screen flex flex-col bg-background">
        <ProductDetailScreen />
      </div>
    );
  }

  return <Navigate to="/home" replace />;
}

function GuestAvatarPrompt() {
  const { guestState } = useGuest();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (guestState.isGuest && !guestState.avatar?.headId) {
      setOpen(true);
    }
  }, [guestState.isGuest, guestState.avatar?.headId]);

  if (!guestState.isGuest) return null;
  const prefGender = (guestState.preferences?.gender as 'male' | 'female' | undefined) || 'male';
  return <GuestAvatarModal open={open} onOpenChange={setOpen} defaultGender={prefGender} />;
}
