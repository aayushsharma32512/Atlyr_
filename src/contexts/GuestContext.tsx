import { createContext, useContext, useEffect, useState, ReactNode, useMemo } from 'react';

type GuestAvatar = {
  headId: string | null;
  imageUrl: string | null;
  scalingFactor: number | null;
  gender: 'male' | 'female' | null;
};

interface GuestState {
  isGuest: boolean;
  guestId: string | null;
  cart: any[];
  favorites: string[];
  preferences: any;
  studioSession: any;
  avatar: GuestAvatar;
}

interface GuestContextType {
  guestState: GuestState;
  signInAsGuest: () => void;
  addToCart: (item: any) => void;
  removeFromCart: (itemId: string) => void;
  addToFavorites: (outfitId: string) => void;
  removeFromFavorites: (outfitId: string) => void;
  updatePreferences: (preferences: any) => void;
  updateStudioSession: (session: any) => void;
  setGuestAvatar: (avatar: GuestAvatar) => void;
  applyGuestAvatarSelection: (avatar: GuestAvatar, preferences: any) => void;
  clearGuestData: () => void;
  getGuestId: () => string;
}

const GuestContext = createContext<GuestContextType | undefined>(undefined);

export function GuestProvider({ children }: { children: ReactNode }) {
  const [guestState, setGuestState] = useState<GuestState>({
    isGuest: false,
    guestId: null,
    cart: [],
    favorites: [],
    preferences: {},
    studioSession: null,
    avatar: { headId: null, imageUrl: null, scalingFactor: null, gender: null },
  });

  // Generate a unique guest ID
  const generateGuestId = (): string => {
    return `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  // Load guest data from localStorage
  const loadGuestData = (guestId: string) => {
    try {
      const cart = JSON.parse(localStorage.getItem(`guest_cart_${guestId}`) || '[]');
      const favorites = JSON.parse(localStorage.getItem(`guest_favorites_${guestId}`) || '[]');
      const preferences = JSON.parse(localStorage.getItem(`guest_preferences_${guestId}`) || '{}');
      const studioSession = JSON.parse(localStorage.getItem(`guest_studio_${guestId}`) || 'null');
      const avatar = JSON.parse(localStorage.getItem(`guest_avatar_${guestId}`) || '{"headId":null,"imageUrl":null,"scalingFactor":null,"gender":null}');

      return { cart, favorites, preferences, studioSession, avatar };
    } catch (error) {
      console.error('Error loading guest data:', error);
      return { cart: [], favorites: [], preferences: {}, studioSession: null, avatar: { headId: null, imageUrl: null, scalingFactor: null, gender: null } };
    }
  };

  // Save guest data to localStorage
  const saveGuestData = (guestId: string, data: any) => {
    try {
      Object.entries(data).forEach(([key, value]) => {
        localStorage.setItem(`guest_${key}_${guestId}`, JSON.stringify(value));
      });
    } catch (error) {
      console.error('Error saving guest data:', error);
    }
  };

  const signInAsGuest = () => {
    const guestId = generateGuestId();
    const guestData = loadGuestData(guestId);
    
    setGuestState({
      isGuest: true,
      guestId,
      ...guestData,
    });

    // Save initial state
    saveGuestData(guestId, guestData);
  };

  // Ensure we have a guest id ready; returns the active id
  const ensureGuestId = (): string => {
    let id = guestState.guestId || localStorage.getItem('current_guest_id');
    if (!id) {
      id = generateGuestId();
      // Initialize minimal guest session
      setGuestState(prev => ({
        ...prev,
        isGuest: true,
        guestId: id,
      }));
      localStorage.setItem('current_guest_id', id);
    }
    return id;
  };

  const addToCart = (item: any) => {
    if (!guestState.guestId) return;

    const updatedCart = [...guestState.cart, item];
    setGuestState(prev => ({ ...prev, cart: updatedCart }));
    saveGuestData(guestState.guestId, { cart: updatedCart });
  };

  const removeFromCart = (itemId: string) => {
    if (!guestState.guestId) return;

    const updatedCart = guestState.cart.filter(item => item.id !== itemId);
    setGuestState(prev => ({ ...prev, cart: updatedCart }));
    saveGuestData(guestState.guestId, { cart: updatedCart });
  };

  const addToFavorites = (outfitId: string) => {
    if (!guestState.guestId) return;

    const updatedFavorites = [...guestState.favorites, outfitId];
    setGuestState(prev => ({ ...prev, favorites: updatedFavorites }));
    saveGuestData(guestState.guestId, { favorites: updatedFavorites });
  };

  const removeFromFavorites = (outfitId: string) => {
    if (!guestState.guestId) return;

    const updatedFavorites = guestState.favorites.filter(id => id !== outfitId);
    setGuestState(prev => ({ ...prev, favorites: updatedFavorites }));
    saveGuestData(guestState.guestId, { favorites: updatedFavorites });
  };

  const updatePreferences = (preferences: any) => {
    if (!guestState.guestId) return;

    const updatedPreferences = { ...guestState.preferences, ...preferences };
    setGuestState(prev => ({ ...prev, preferences: updatedPreferences }));
    saveGuestData(guestState.guestId, { preferences: updatedPreferences });
  };

  const updateStudioSession = (session: any) => {
    if (!guestState.guestId) return;

    setGuestState(prev => ({ ...prev, studioSession: session }));
    saveGuestData(guestState.guestId, { studioSession: session });
  };

  const setGuestAvatar = (avatar: GuestAvatar) => {
    const id = ensureGuestId();
    setGuestState(prev => ({ ...prev, isGuest: true, guestId: id, avatar }));
    try {
      localStorage.setItem(`guest_avatar_${id}`, JSON.stringify(avatar));
    } catch (error) {
      console.error('Error saving guest avatar:', error);
    }
  };

  // Batch avatar + preferences updates in a single render & storage write
  const applyGuestAvatarSelection = (avatar: GuestAvatar, preferences: any) => {
    const id = ensureGuestId();
    const mergedPrefs = { ...guestState.preferences, ...preferences };
    setGuestState(prev => ({
      ...prev,
      isGuest: true,
      guestId: id,
      avatar,
      preferences: mergedPrefs,
    }));
    // Persist both together
    saveGuestData(id, { avatar, preferences: mergedPrefs });
  };

  const clearGuestData = () => {
    if (guestState.guestId) {
      localStorage.removeItem(`guest_cart_${guestState.guestId}`);
      localStorage.removeItem(`guest_favorites_${guestState.guestId}`);
      localStorage.removeItem(`guest_preferences_${guestState.guestId}`);
      localStorage.removeItem(`guest_studio_${guestState.guestId}`);
      localStorage.removeItem(`guest_avatar_${guestState.guestId}`);
    }
    
    setGuestState({
      isGuest: false,
      guestId: null,
      cart: [],
      favorites: [],
      preferences: {},
      studioSession: null,
      avatar: { headId: null, imageUrl: null, scalingFactor: null, gender: null },
    });
  };

  const getGuestId = (): string => {
    return guestState.guestId || generateGuestId();
  };

  // Check for existing guest session on mount
  useEffect(() => {
    const existingGuestId = localStorage.getItem('current_guest_id');
    if (existingGuestId) {
      const guestData = loadGuestData(existingGuestId);
      setGuestState({
        isGuest: true,
        guestId: existingGuestId,
        ...guestData,
      });
    }
  }, []);

  // Save current guest ID
  useEffect(() => {
    if (guestState.guestId) {
      localStorage.setItem('current_guest_id', guestState.guestId);
    } else {
      localStorage.removeItem('current_guest_id');
    }
  }, [guestState.guestId]);

  const value = useMemo(() => ({
    guestState,
    signInAsGuest,
    addToCart,
    removeFromCart,
    addToFavorites,
    removeFromFavorites,
    updatePreferences,
    updateStudioSession,
    setGuestAvatar,
    applyGuestAvatarSelection,
    clearGuestData,
    getGuestId,
  }), [
    guestState,
    signInAsGuest,
    addToCart,
    removeFromCart,
    addToFavorites,
    removeFromFavorites,
    updatePreferences,
    updateStudioSession,
    setGuestAvatar,
    applyGuestAvatarSelection,
    clearGuestData,
    getGuestId,
  ]);

  return (
    <GuestContext.Provider value={value}>
      {children}
    </GuestContext.Provider>
  );
}

export function useGuest() {
  const context = useContext(GuestContext);
  if (context === undefined) {
    throw new Error('useGuest must be used within a GuestProvider');
  }
  return context;
} 
