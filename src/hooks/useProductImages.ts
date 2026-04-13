import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../integrations/supabase/client';
import { ProductImage } from '../types';

// Simple in-memory cache for session-scoped image lists per product
const imageCache: Map<string, ProductImage[]> = new Map();

/**
 * Preload a subset of images by creating Image objects (browser cache warmup)
 */
function warmImageCache(urls: string[], limit = 2) {
  const slice = urls.slice(0, Math.max(0, limit));
  slice.forEach((u) => {
    if (!u) return;
    const img = new Image();
    img.src = u;
  });
}

/**
 * Build the combined image array: flatlay (primary) + ordered model images
 */
function buildCombinedImages(productId: string, primaryImageUrl: string, modelImages: ProductImage[]): ProductImage[] {
  const primaryImage: ProductImage = {
    id: 'primary',
    product_id: productId,
    kind: 'flatlay',
    sort_order: 0,
    is_primary: true,
    url: primaryImageUrl,
    gender: null,
    created_at: null,
    updated_at: null
  };
  return [primaryImage, ...modelImages];
}

/**
 * Fetch model images for a product (no vto_eligible filter), ordered by
 * primary first, then sort_order, then id for stability.
 */
async function fetchModelImagesForProduct(productId: string): Promise<ProductImage[]> {
  const { data, error: fetchError } = await supabase
    .from('product_images')
    .select('*')
    .eq('product_id', productId)
    .eq('kind', 'model')
    .order('is_primary', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (fetchError) {
    throw fetchError;
  }

  const typedData = (data || []).map(item => ({
    ...item,
    kind: item.kind as 'flatlay' | 'model' | 'detail',
    gender: (item.gender === 'male' || item.gender === 'female') ? item.gender : null
  })) as ProductImage[];

  return typedData;
}

/**
 * Preload images for a product (metadata + warm up first N URLs).
 */
export async function preloadProductImages(productId: string, primaryImageUrl: string, warmCount = 2): Promise<ProductImage[]> {
  if (!productId) return [];
  // Return cached if present
  if (imageCache.has(productId)) {
    const cached = imageCache.get(productId)!;
    warmImageCache(cached.map(i => i.url).filter(Boolean) as string[], warmCount);
    return cached;
  }
  const modelImages = await fetchModelImagesForProduct(productId);
  const combined = buildCombinedImages(productId, primaryImageUrl, modelImages);
  imageCache.set(productId, combined);
  warmImageCache(combined.map(i => i.url).filter(Boolean) as string[], warmCount);
  return combined;
}

interface UseProductImagesReturn {
  allImages: ProductImage[];
  loading: boolean;
  error: string | null;
}

export function useProductImages(productId: string, primaryImageUrl: string): UseProductImagesReturn {
  const [modelImages, setModelImages] = useState<ProductImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchModelImages = useCallback(async () => {
    if (!productId) {
      setModelImages([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      // Use cache when available
      if (imageCache.has(productId)) {
        setModelImages(imageCache.get(productId)!.filter(img => img.kind === 'model'));
        return;
      }

      const typedData = await fetchModelImagesForProduct(productId);
      setModelImages(typedData);
      // Prime cache with combined images
      const combined = buildCombinedImages(productId, primaryImageUrl, typedData);
      imageCache.set(productId, combined);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch model images');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    fetchModelImages();
  }, [fetchModelImages]);

  // Combined array with primary (flatlay) first, then model images
  const allImages: ProductImage[] = buildCombinedImages(productId, primaryImageUrl, modelImages);

  return {
    allImages,
    loading,
    error,
  };
}
