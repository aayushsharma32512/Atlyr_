/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Outfit } from '@/types';

interface UseOutfitsWithProductReturn {
  outfits: Outfit[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  totalCount: number;
  loadMore: () => void;
}

// Database response type for outfits with product
interface DatabaseOutfitWithProduct {
  id: string;
  name: string;
  category: string;
  gender?: string | null;
  background_id?: string | null;
  fit?: string | null;
  feel?: string | null;
  word_association?: string | null;
  rating?: number | null;
  popularity?: number | null;
  created_at?: string | null;
  created_by?: string | null;
  occasion: {
    id: string;
    name: string;
    slug: string;
    background_url: string;
    description?: string | null;
  };
  top?: {
    id: string;
    type: string;
    brand: string;
    gender?: string | null;
    product_name?: string | null;
    size: string;
    price: number;
    currency: string;
    image_url: string;
    description: string;
    color: string;
    color_group?: string | null;
    category_id?: string | null;
    fit?: string | null;
    feel?: string | null;
    placement_x?: number | null;
    placement_y?: number | null;
    image_length?: number | null;
  } | null;
  bottom?: {
    id: string;
    type: string;
    brand: string;
    gender?: string | null;
    product_name?: string | null;
    size: string;
    price: number;
    currency: string;
    image_url: string;
    description: string;
    color: string;
    color_group?: string | null;
    category_id?: string | null;
    fit?: string | null;
    feel?: string | null;
    placement_x?: number | null;
    placement_y?: number | null;
    image_length?: number | null;
  } | null;
  shoes?: {
    id: string;
    type: string;
    brand: string;
    gender?: string | null;
    product_name?: string | null;
    size: string;
    price: number;
    currency: string;
    image_url: string;
    description: string;
    color: string;
    color_group?: string | null;
    category_id?: string | null;
    fit?: string | null;
    feel?: string | null;
    placement_x?: number | null;
    placement_y?: number | null;
    image_length?: number | null;
  } | null;
}

export function useOutfitsWithProduct(productId?: string, itemsPerPage: number = 10): UseOutfitsWithProductReturn {
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const offsetRef = useRef(0);

  const fetchOutfits = useCallback(async (isLoadMore: boolean = false) => {
    if (!productId) {
      setOutfits([]);
      setTotalCount(0);
      setHasMore(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const currentOffset = isLoadMore ? offsetRef.current : 0;

      // Query outfits that contain the specific product in their items
      const { data, error: fetchError, count } = await supabase
        .from('outfits')
        .select(`
          *,
          occasion:occasions!occasion(*),
          top:products!outfits_top_id_fkey(*),
          bottom:products!outfits_bottom_id_fkey(*),
          shoes:products!outfits_shoes_id_fkey(*)
        `)
        .or(`top_id.eq.${productId},bottom_id.eq.${productId},shoes_id.eq.${productId}`)
        .range(currentOffset, currentOffset + itemsPerPage - 1)
        .order('created_at', { ascending: false });

      if (fetchError) {
        throw fetchError;
      }

      // Transform the data to Outfit format
      const transformedOutfits = (data || []).map((outfit) => {
        const items = [
          outfit.top && {
            id: (outfit.top as any).id,
            type: (outfit.top as any).type,
            brand: (outfit.top as any).brand,
            gender: (outfit.top as any).gender,
            product_name: (outfit.top as any).product_name,
            size: (outfit.top as any).size,
            price: (outfit.top as any).price,
            currency: (outfit.top as any).currency,
            imageUrl: (outfit.top as any).image_url,
            description: (outfit.top as any).description,
            color: (outfit.top as any).color,
            color_group: (outfit.top as any).color_group,
            category_id: (outfit.top as any).category_id,
            fit: (outfit.top as any).fit,
            feel: (outfit.top as any).feel,
            placement_x: (outfit.top as any).placement_x,
            placement_y: (outfit.top as any).placement_y,
            image_length: (outfit.top as any).image_length
          },
          outfit.bottom && {
            id: (outfit.bottom as any).id,
            type: (outfit.bottom as any).type,
            brand: (outfit.bottom as any).brand,
            gender: (outfit.bottom as any).gender,
            product_name: (outfit.bottom as any).product_name,
            size: (outfit.bottom as any).size,
            price: (outfit.bottom as any).price,
            currency: (outfit.bottom as any).currency,
            imageUrl: (outfit.bottom as any).image_url,
            description: (outfit.bottom as any).description,
            color: (outfit.bottom as any).color,
            color_group: (outfit.bottom as any).color_group,
            category_id: (outfit.bottom as any).category_id,
            fit: (outfit.bottom as any).fit,
            feel: (outfit.bottom as any).feel,
            placement_x: (outfit.bottom as any).placement_x,
            placement_y: (outfit.bottom as any).placement_y,
            image_length: (outfit.bottom as any).image_length
          },
          outfit.shoes && {
            id: (outfit.shoes as any).id,
            type: (outfit.shoes as any).type,
            brand: (outfit.shoes as any).brand,
            gender: (outfit.shoes as any).gender,
            product_name: (outfit.shoes as any).product_name,
            size: (outfit.shoes as any).size,
            price: (outfit.shoes as any).price,
            currency: (outfit.shoes as any).currency,
            imageUrl: (outfit.shoes as any).image_url,
            description: (outfit.shoes as any).description,
            color: (outfit.shoes as any).color,
            color_group: (outfit.shoes as any).color_group,
            category_id: (outfit.shoes as any).category_id,
            fit: (outfit.shoes as any).fit,
            feel: (outfit.shoes as any).feel,
            placement_x: (outfit.shoes as any).placement_x,
            placement_y: (outfit.shoes as any).placement_y,
            image_length: (outfit.shoes as any).image_length
          }
        ].filter(Boolean);

        const totalPrice = items.reduce((sum, item) => sum + (item?.price || 0), 0);
        const currency = items[0]?.currency || 'INR';

        return {
          id: outfit.id,
          name: outfit.name,
          category: outfit.category,
          gender: outfit.gender,
          totalPrice,
          currency,
          occasion: {
            id: (outfit.occasion as any).id,
            name: (outfit.occasion as any).name,
            slug: (outfit.occasion as any).slug,
            backgroundUrl: (outfit.occasion as any).background_url,
            description: (outfit.occasion as any).description || ''
          },
          backgroundId: outfit.background_id,
          items,
          fit: outfit.fit,
          feel: outfit.feel,
          word_association: outfit.word_association,
          rating: outfit.rating,
          popularity: outfit.popularity,
          created_at: outfit.created_at,
          created_by: outfit.created_by
        } as Outfit;
      });

      if (isLoadMore) {
        setOutfits(prev => [...prev, ...transformedOutfits]);
      } else {
        setOutfits(transformedOutfits);
      }

      setTotalCount(count || 0);
      setHasMore((currentOffset + itemsPerPage) < (count || 0));
      offsetRef.current = currentOffset + itemsPerPage;

    } catch (err) {
      console.error('Error fetching outfits with product:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch outfits');
    } finally {
      setLoading(false);
    }
  }, [productId, itemsPerPage]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchOutfits(true);
    }
  }, [loading, hasMore, fetchOutfits]);

  useEffect(() => {
    offsetRef.current = 0;
    fetchOutfits(false);
  }, [productId, fetchOutfits]);

  return {
    outfits,
    loading,
    error,
    hasMore,
    totalCount,
    loadMore
  };
}
