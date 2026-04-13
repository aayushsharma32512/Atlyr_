import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Outfit, OutfitItem } from '@/types';
import { dataTransformers } from '@/utils/dataTransformers';
import { APP_CONSTANTS } from '@/utils/constants';
import type { TablesInsert } from '@/integrations/supabase/types';

export function useOutfits() {
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOutfits();
  }, []);

  const fetchOutfits = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch outfits with manual joins since foreign keys aren't defined
      // Only fetch outfits that are visible in the feed
      const { data: outfitsData, error: outfitsError } = await supabase
        .from('outfits')
        .select(`
          *,
          occasion:occasions!occasion(id, name, slug, background_url, description),
          top:products!outfits_top_id_fkey(*),
          bottom:products!outfits_bottom_id_fkey(*),
          shoes:products!outfits_shoes_id_fkey(*)
        `)
        .eq('visible_in_feed', true);

      if (outfitsError) throw outfitsError;

      // Transform outfits using centralized data transformer
      const transformedOutfits: Outfit[] = (outfitsData || []).map(outfit => dataTransformers.outfit(outfit));

      setOutfits(transformedOutfits);
    } catch (err) {
      console.error('Error fetching outfits:', err);
      setError('Failed to fetch outfits');
    } finally {
      setLoading(false);
    }
  };

  // Dynamic function to get outfits for "For You" page
  const getForYouOutfits = useCallback(async (sourceOutfits?: Outfit[]): Promise<Outfit[]> => {
    // Pure client-side: group existing outfits by category and pick top N by rating
    const pool = sourceOutfits || outfits;
    const byCategory: Record<string, Outfit[]> = {};
    for (const o of pool) {
      const key = o.category || 'misc';
      (byCategory[key] ||= []).push(o);
    }
    const result: Outfit[] = [];
    Object.values(byCategory).forEach(list => {
      const sorted = [...list].sort((a, b) => (b.rating || 0) - (a.rating || 0));
      result.push(...sorted);
    });
    return result;
  }, [outfits]);

  const getOutfitsByCategory = useCallback(async (categorySlug: string, userGender?: 'male' | 'female'): Promise<Outfit[]> => {
    const genderFiltered = userGender
      ? outfits.filter(o => (o as any).gender && (((o as any).gender === userGender) || ((o as any).gender === 'unisex')))
      : outfits.filter(o => (o as any).gender);

    if (categorySlug === APP_CONSTANTS.CATEGORIES.FOR_YOU) {
      // For You operates on already gender-filtered list
      return await getForYouOutfits(genderFiltered);
    }
    return genderFiltered.filter(outfit => outfit.category === categorySlug);
  }, [outfits, getForYouOutfits]);

  const getAlternativeItems = useCallback((type: OutfitItem['type'], currentOutfit?: Outfit, filterMode: 'alternate' | 'similar' | 'favorites' | 'wardrobe' | 'all' = 'alternate', userGender?: 'male' | 'female'): OutfitItem[] => {
    const allItems: OutfitItem[] = [];

    // Gender-aware: exclude null genders; include only matching + unisex
    const genderFilteredOutfits = userGender
      ? outfits.filter(o => (o as any).gender && (((o as any).gender === userGender) || ((o as any).gender === 'unisex')))
      : outfits.filter(o => (o as any).gender); // if not provided, exclude null to be safe

    genderFilteredOutfits.forEach(outfit => {
      outfit.items.forEach(item => {
        if (item.type === type && !allItems.find(existing => existing.id === item.id)) {
          // Apply filter based on mode
          let shouldInclude = true;

          if (currentOutfit && filterMode === 'similar') {
            // For similar mode, only include items from same category
            shouldInclude = outfit.category === currentOutfit.category;
          }
          // For 'all' mode, include all items of the same type (no category restriction)
          if (filterMode === 'all') {
            // Include all items of the same type, regardless of outfit category
            shouldInclude = true;
          }
          // Gender-aware item-level filter
          if (userGender) {
            const itemGender = (item as any).gender;
            const genderOk = itemGender && (itemGender === userGender || itemGender === 'unisex');
            shouldInclude = shouldInclude && genderOk;
          }
          // For 'alternate', 'favorites', 'wardrobe' modes, include all items (after gender check)

          if (shouldInclude) {
            allItems.push(item);
          }
        }
      });
    });

    return allItems;
  }, [outfits]);

  // Add outfit to database
  const addOutfit = async (payload: TablesInsert<'outfits'>) => {
    // payload typed to DB Insert for safety
    try {
      const { data, error } = await supabase
        .from('outfits')
        .insert([payload])
        .select()
        .single();
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  };

  return {
    outfits,
    loading,
    error,
    getOutfitsByCategory,
    getAlternativeItems,
    refetch: fetchOutfits,
    addOutfit,
  };
}
