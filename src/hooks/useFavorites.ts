import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useGuest } from '@/contexts/GuestContext';
import { Outfit } from '@/types';
import { dataTransformers } from '@/utils/dataTransformers';

export function useFavorites() {
  const { user } = useAuth();
  const { guestState, addToFavorites: addToGuestFavorites, removeFromFavorites: removeFromGuestFavorites } = useGuest();
  const [favorites, setFavorites] = useState<Record<string, Outfit>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Memoize the guest favorites to prevent infinite re-renders
  const guestFavorites = useMemo(() => guestState.favorites || [], [guestState.favorites]);

  useEffect(() => {
    if (user) {
      fetchFavorites();
    } else if (guestState.isGuest) {
      loadGuestFavorites();
    } else {
      // For non-authenticated users, just use empty state
      setFavorites({});
      setLoading(false);
    }
  }, [user, guestState.isGuest]);

  // Separate effect to handle guest favorites updates
  useEffect(() => {
    if (guestState.isGuest && guestFavorites.length > 0) {
      loadGuestFavorites();
    }
  }, [guestFavorites, guestState.isGuest]);

  const loadGuestFavorites = async () => {
    try {
      // Guest favorites are managed by GuestContext
      const guestFavoritesList = guestFavorites;

      if (guestFavoritesList.length === 0) {
        setFavorites({});
        setLoading(false);
        return;
      }

      // Fetch actual outfit data for guest favorites
      const { data: outfitsData, error: outfitsError } = await supabase
        .from('outfits')
        .select(`
          *,
          occasion:occasions!occasion(id, name, slug, background_url, description),
          top:products!outfits_top_id_fkey(*),
          bottom:products!outfits_bottom_id_fkey(*),
          shoes:products!outfits_shoes_id_fkey(*)
        `)
        .in('id', guestFavoritesList);

      if (outfitsError) throw outfitsError;

      // Transform outfits using the same data transformer
      const favoritesMap: Record<string, Outfit> = {};

      (outfitsData || []).forEach(outfit => {
        favoritesMap[outfit.id] = dataTransformers.outfit(outfit);
      });

      setFavorites(favoritesMap);
    } catch (error) {
      console.error('Error loading guest favorites:', error);
      setFavorites({});
    } finally {
      setLoading(false);
    }
  };

  const fetchFavorites = async () => {
    if (!user) return;

    try {
      setLoading(true);
      setError(null);

      // Fetch favorites with outfit data
      const { data, error } = await (supabase as any)
        .from('user_favorites')
        .select(`
          outfit_id,
          outfits (
            id,
            name,
            category,
            background_id,
            occasion:occasions!occasion(id, name, slug, background_url, description),
            top:products!outfits_top_id_fkey(*),
            bottom:products!outfits_bottom_id_fkey(*),
            shoes:products!outfits_shoes_id_fkey(*)
          )
        `)
        .eq('user_id', user.id)
        .eq('collection_slug', 'favorites');

      if (error) throw error;

      // Use centralized data transformer
      const transformedFavorites: Record<string, Outfit> = {};

      (data || []).forEach(fav => {
        const outfit = fav.outfits;
        if (outfit) {
          transformedFavorites[outfit.id] = dataTransformers.outfit(outfit);
        }
      });

      setFavorites(transformedFavorites);
    } catch (err) {
      console.error('Error fetching favorites:', err);
      setError('Failed to fetch favorites');
    } finally {
      setLoading(false);
    }
  };

  const addFavorite = async (outfit: Outfit) => {
    if (guestState.isGuest) {
      // For guests, use guest context
      addToGuestFavorites(outfit.id);

      // Update local state
      setFavorites(prev => ({ ...prev, [outfit.id]: outfit }));
      return;
    }

    if (!user) return;

    try {
      const { error } = await supabase
        .from('user_favorites')
        .insert({
          user_id: user.id,
          outfit_id: outfit.id,
          collection_slug: 'favorites',
          collection_label: 'Favorites',
        });

      if (error) throw error;

      // Update local state
      setFavorites(prev => ({ ...prev, [outfit.id]: outfit }));
    } catch (err) {
      console.error('Failed to add favorite:', err);
      throw err;
    }
  };

  const removeFavorite = async (outfitId: string) => {
    if (guestState.isGuest) {
      // For guests, use guest context
      removeFromGuestFavorites(outfitId);

      // Update local state
      setFavorites(prev => {
        const newFavorites = { ...prev };
        delete newFavorites[outfitId];
        return newFavorites;
      });
      return;
    }

    if (!user) return;

    try {
      const { error } = await (supabase as any)
        .from('user_favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('collection_slug', 'favorites')
        .eq('outfit_id', outfitId);

      if (error) throw error;

      // Update local state
      setFavorites(prev => {
        const newFavorites = { ...prev };
        delete newFavorites[outfitId];
        return newFavorites;
      });
    } catch (err) {
      console.error('Failed to remove favorite:', err);
      throw err;
    }
  };

  const toggleFavorite = async (outfit: Outfit) => {
    if (favorites[outfit.id]) {
      await removeFavorite(outfit.id);
    } else {
      await addFavorite(outfit);
    }
  };

  const isFavorite = (outfitId: string) => {
    if (guestState.isGuest) {
      return guestState.favorites.includes(outfitId);
    }
    return !!favorites[outfitId];
  };

  const favoritesList = useMemo(() => Object.values(favorites), [favorites]);

  return {
    favorites: favoritesList,
    loading,
    error,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    isFavorite,
    refetch: fetchFavorites
  };
}
