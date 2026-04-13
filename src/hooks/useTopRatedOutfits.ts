import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Outfit, OutfitItem } from '@/types';
import { useOutfits } from '@/hooks/useOutfits';

// Interface for the transformed data that UI components will use
export interface CategoryWithOutfit {
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  outfitCount: number;
  outfit: {
    id: string;
    name: string;
    rating: number | null;
    backgroundId: string | null;
    occasion: {
      id: string;
      name: string;
      backgroundUrl: string;
    };
    items: OutfitItem[];
  };
}

// Build a gender filter that includes unisex
function isOutfitForGender(outfit: Outfit, gender?: 'male' | 'female'): boolean {
  if (!gender) return !!(outfit as any).gender; // conservative: require tagged gender
  const g = (outfit as any).gender as string | null | undefined;
  return !!g && (g === gender || g === 'unisex');
}

export function useTopRatedOutfits(gender?: 'male' | 'female') {
  const { outfits: allOutfits, loading: outfitsLoading, error: outfitsError } = useOutfits();
  const [categories, setCategories] = useState<CategoryWithOutfit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const genderFilteredOutfits = useMemo(() => {
    return allOutfits.filter(o => isOutfitForGender(o, gender));
  }, [allOutfits, gender]);

  const recompute = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      if (outfitsError) throw new Error(outfitsError);

      // Group by category and compute counts + pick a top-rated outfit per category
      const byCategory: Record<string, { count: number; top: Outfit } > = {};
      for (const outfit of genderFilteredOutfits) {
        const cat = outfit.category;
        if (!cat) continue;
        if (!byCategory[cat]) {
          byCategory[cat] = { count: 0, top: outfit };
        }
        byCategory[cat].count += 1;
        const currentTop = byCategory[cat].top;
        const currentRating = (currentTop.rating || 0);
        const candidateRating = (outfit.rating || 0);
        if (candidateRating > currentRating) {
          byCategory[cat].top = outfit;
        }
      }

      const categoryIds = Object.keys(byCategory);
      if (categoryIds.length === 0) {
        setCategories([]);
        return;
      }

      // Fetch category metadata for the discovered categories
      const { data: categoriesMeta, error: categoriesError } = await supabase
        .from('categories')
        .select('id, name, slug')
        .in('id', categoryIds);

      if (categoriesError) throw categoriesError;

      const metaMap = new Map<string, { name: string; slug: string }>();
      (categoriesMeta || []).forEach(c => metaMap.set(c.id, { name: c.name, slug: c.slug }));

      const result: CategoryWithOutfit[] = categoryIds.map((id) => {
        const entry = byCategory[id];
        const meta = metaMap.get(id) || { name: id, slug: id };
        return {
          categoryId: id,
          categoryName: meta.name,
          categorySlug: meta.slug,
          outfitCount: entry.count,
          outfit: {
            id: entry.top.id,
            name: entry.top.name,
            rating: entry.top.rating || null,
            backgroundId: entry.top.backgroundId || null,
            occasion: {
              id: entry.top.occasion.id,
              name: entry.top.occasion.name,
              backgroundUrl: entry.top.occasion.backgroundUrl
            },
            items: entry.top.items
          }
        };
      }).sort((a, b) => a.categoryName.localeCompare(b.categoryName));

      setCategories(result);
    } catch (err) {
      console.error('Error computing top rated outfits by gender:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  }, [genderFilteredOutfits, outfitsError]);

  useEffect(() => {
    if (!outfitsLoading) {
      void recompute();
    }
  }, [outfitsLoading, recompute]);

  return {
    categories,
    loading: loading || outfitsLoading,
    error,
    refetch: recompute
  };
}