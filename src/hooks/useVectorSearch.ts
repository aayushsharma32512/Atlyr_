import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Outfit, OutfitItem, ItemType } from '@/types';

interface VectorSearchResult {
  outfit?: Outfit;
  item?: OutfitItem;
  similarity: number;
  type: 'outfit' | 'item';
}

// New interfaces to preserve similarity scores
interface OutfitWithSimilarity extends Outfit {
  similarityScore?: number;
}

interface ProductWithSimilarity {
  id: string;
  type: ItemType;
  brand: string;
  product_name?: string;
  size: string;
  price: number;
  currency: string;
  image_url: string;
  description: string;
  color: string;
  color_group?: string;
  gender?: string;
  placement_y?: number;
  placement_x?: number;
  image_length?: number;
  fit?: string;
  feel?: string;
  category_id?: string;
  vibes?: string;
  vibesArray?: string[];
  fitArray?: string[];
  feelArray?: string[];
  similarityScore?: number;
}

type OutfitFiltersPayload = {
  genders?: Array<'male' | 'female' | 'unisex'>;
  categories?: string[];
  occasions?: string[];
  fits?: string[];
}

type ProductFiltersPayload = {
  genders?: Array<'male' | 'female' | 'unisex'>;
  typeCategories?: string[];
  brands?: string[];
  fits?: string[];
  feels?: string[];
  colorGroups?: string[];
  sizes?: string[];
  minPrice?: number;
  maxPrice?: number;
}

interface UseVectorSearchReturn {
  searchOutfits: (query: string, limit?: number, gender?: 'male' | 'female', filters?: OutfitFiltersPayload) => Promise<OutfitWithSimilarity[]>;
  searchItems: (query: string, limit?: number, gender?: 'male' | 'female', filters?: ProductFiltersPayload) => Promise<ProductWithSimilarity[]>;
  searchItemsByCategory: (query: string, category: ItemType, limit?: number, gender?: 'male' | 'female', filters?: ProductFiltersPayload) => Promise<ProductWithSimilarity[]>;
  searchAll: (query: string, limit?: number) => Promise<VectorSearchResult[]>;
  loading: boolean;
  error: string | null;
}

// Vector search using Supabase Edge Function via supabase client (works in prod without Vite envs)
async function vectorSearch(query: string, searchType: 'outfits' | 'products', limit: number = 10, category?: ItemType, gender?: 'male' | 'female', filters?: OutfitFiltersPayload | ProductFiltersPayload): Promise<unknown[]> {
  try {
    const { data, error } = await supabase.functions.invoke('vector-search', {
      body: {
        query,
        searchType,
        limit,
        category,
        gender,
        filters,
        // Very low threshold for more inclusive results
        threshold: 0.1,
      },
    });

    if (error) {
      throw new Error(error.message || 'Vector search function error');
    }

    const payload = data as { results?: unknown[] } | null;
    return payload?.results ?? [];
  } catch (error) {
    console.error('Vector search error:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to perform vector search');
  }
}

export function useVectorSearch(): UseVectorSearchReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search outfits using vector similarity with raw SQL
  const searchOutfits = useCallback(async (query: string, limit: number = 10, gender?: 'male' | 'female', filters?: OutfitFiltersPayload): Promise<OutfitWithSimilarity[]> => {
    if (!query.trim()) return [];

    setLoading(true);
    setError(null);

    try {
      // Perform vector search using Edge Function
      const data = await vectorSearch(query, 'outfits', limit, undefined, gender, filters);

      // Fetch complete outfit data including items for each outfit
      const { supabase } = await import('@/integrations/supabase/client');
      const { dataTransformers } = await import('@/utils/dataTransformers');

      const completeOutfits: OutfitWithSimilarity[] = [];

      for (const item of data) {
        const outfitId = (item as any).id as string;
        const similarityScore = (item as any).similarity as number;

        // Fetch complete outfit data with items
        const { data: outfitData, error: outfitError } = await supabase
          .from('outfits')
          .select(`
            *,
            occasion:occasions!occasion(id, name, slug, background_url, description),
            top:products!outfits_top_id_fkey(*),
            bottom:products!outfits_bottom_id_fkey(*),
            shoes:products!outfits_shoes_id_fkey(*)
          `)
          .eq('id', outfitId)
          .single();

        if (outfitError) {
          console.error(`Error fetching outfit ${outfitId}:`, outfitError);
          // Fallback to basic outfit data without items
          const basicOutfit: OutfitWithSimilarity = {
            id: outfitId,
            name: (item as any).name as string,
            category: (item as any).category as string,
            totalPrice: 0,
            currency: 'INR',
            occasion: {
              id: (item as any).occasion as string,
              name: (item as any).occasion as string,
              slug: (item as any).occasion as string,
              backgroundUrl: '',
              description: ''
            },
            backgroundId: (item as any).background_id as string,
            items: [], // Empty items array as fallback
            gender: ((item as any).gender === 'male' || (item as any).gender === 'female' || (item as any).gender === 'unisex') ? (item as any).gender as 'male' | 'female' | 'unisex' : undefined,
            fit: (item as any).fit as string | undefined,
            feel: (item as any).feel as string | undefined,
            word_association: (item as any).word_association as string | undefined,
            rating: ((item as any).rating as number) || 0,
            popularity: ((item as any).popularity as number) || 0,
            created_at: (item as any).created_at as string,
            created_by: (item as any).created_by as string | undefined,
            similarityScore
          };
          completeOutfits.push(basicOutfit);
        } else {
          // Transform complete outfit data using dataTransformers
          const transformedOutfit = dataTransformers.outfit(outfitData);
          // Add similarity score to the transformed outfit
          const outfitWithSimilarity: OutfitWithSimilarity = {
            ...transformedOutfit,
            similarityScore
          };
          completeOutfits.push(outfitWithSimilarity);
        }
      }

      return completeOutfits;

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Search failed';
      setError(errorMessage);
      console.error('Vector search error:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Search items using vector similarity with raw SQL
  const searchItems = useCallback(async (query: string, limit: number = 10, gender?: 'male' | 'female', filters?: ProductFiltersPayload): Promise<ProductWithSimilarity[]> => {
    if (!query.trim()) return [];

    setLoading(true);
    setError(null);

    try {
      // Perform vector search using Edge Function
      const data = await vectorSearch(query, 'products', limit, undefined, gender, filters);

      // Transform the results to match ProductWithSimilarity type
      const items: ProductWithSimilarity[] = data.map((item: Record<string, unknown>) => ({
        id: item.id as string,
        type: item.type as ItemType,
        brand: item.brand as string,
        product_name: item.product_name as string || undefined,
        size: item.size as string,
        price: item.price as number,
        currency: item.currency as string,
        image_url: item.image_url as string,
        description: item.description as string,
        color: item.color as string,
        color_group: item.color_group as string || undefined,
        gender: item.gender as string || undefined,
        placement_y: item.placement_y as number || undefined,
        placement_x: item.placement_x as number || undefined,
        image_length: item.image_length as number || undefined,
        fit: item.fit as string || undefined,
        feel: item.feel as string || undefined,
        category_id: item.category_id as string || undefined,
        vibes: item.vibes as string || undefined,
        vibesArray: item.vibesArray as string[] || undefined,
        fitArray: item.fitArray as string[] || undefined,
        feelArray: item.feelArray as string[] || undefined,
        similarityScore: item.similarity as number
      }));

      return items;

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Search failed';
      setError(errorMessage);
      console.error('Vector search error:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Search items with category pre-filtering
  const searchItemsByCategory = useCallback(async (query: string, category: ItemType, limit: number = 10, gender?: 'male' | 'female', filters?: ProductFiltersPayload): Promise<ProductWithSimilarity[]> => {
    if (!query.trim()) return [];

    setLoading(true);
    setError(null);

    try {
      const data = await vectorSearch(query, 'products', limit, category, gender, filters);
      const items: ProductWithSimilarity[] = data.map((item: Record<string, unknown>) => ({
        id: item.id as string,
        type: item.type as ItemType,
        brand: item.brand as string,
        product_name: item.product_name as string || undefined,
        size: item.size as string,
        price: item.price as number,
        currency: item.currency as string,
        image_url: item.image_url as string,
        description: item.description as string,
        color: item.color as string,
        color_group: item.color_group as string || undefined,
        gender: item.gender as string || undefined,
        placement_y: item.placement_y as number || undefined,
        placement_x: item.placement_x as number || undefined,
        image_length: item.image_length as number || undefined,
        fit: item.fit as string || undefined,
        feel: item.feel as string || undefined,
        category_id: item.category_id as string || undefined,
        vibes: item.vibes as string || undefined,
        vibesArray: item.vibesArray as string[] || undefined,
        fitArray: item.fitArray as string[] || undefined,
        feelArray: item.feelArray as string[] || undefined,
        similarityScore: item.similarity as number
      }));
      return items;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Search failed';
      setError(errorMessage);
      console.error('Vector search error:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Search both outfits and items
  const searchAll = useCallback(async (query: string, limit: number = 10): Promise<VectorSearchResult[]> => {
    if (!query.trim()) return [];

    setLoading(true);
    setError(null);

    try {
      const [outfits, items] = await Promise.all([
        searchOutfits(query, limit),
        searchItems(query, limit)
      ]);

      // Combine and sort by similarity (we'll use a simple approach for now)
      const results: VectorSearchResult[] = [
        ...outfits.map(outfit => ({
          outfit,
          type: 'outfit' as const,
          similarity: outfit.similarityScore || 0.8 // Use actual similarity score or fallback
        })),
        ...items.map(item => ({
          item: {
            id: item.id,
            type: item.type,
            brand: item.brand,
            product_name: item.product_name || null,
            size: item.size,
            price: item.price,
            currency: item.currency,
            imageUrl: item.image_url,
            description: item.description,
            color: item.color,
            color_group: item.color_group || null,
            gender: item.gender || null,
            placement_y: item.placement_y || null,
            placement_x: item.placement_x || null,
            image_length: item.image_length || null,
            fit: item.fit || null,
            feel: item.feel || null,
            category_id: item.category_id || null,
            sizeOptions: [],
            colorSwatches: [],
            material: undefined,
            rating: 0
          } as OutfitItem,
          type: 'item' as const,
          similarity: item.similarityScore || 0.8 // Use actual similarity score or fallback
        }))
      ];

      return results.slice(0, limit);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Search failed';
      setError(errorMessage);
      console.error('Vector search error:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, [searchOutfits, searchItems]);

  return {
    searchOutfits,
    searchItems,
    searchItemsByCategory,
    searchAll,
    loading,
    error
  };
}
