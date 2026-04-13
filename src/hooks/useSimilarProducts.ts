import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Product } from '@/types';

interface UseSimilarProductsReturn {
  similarProducts: Product[];
  loading: boolean;
  error: string | null;
  totalCount: number;
}

export function useSimilarProducts(productId?: string, limit: number = 50): UseSimilarProductsReturn {
  const [similarProducts, setSimilarProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  const fetchSimilarProducts = useCallback(async () => {
    if (!productId) {
      setSimilarProducts([]);
      setTotalCount(0);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // First, get the current product to find its type and gender
      const { data: currentProduct, error: currentProductError } = await supabase
        .from('products')
        .select('type, gender')
        .eq('id', productId)
        .single();

      if (currentProductError) {
        throw currentProductError;
      }

      if (!currentProduct) {
        setError('Product not found');
        return;
      }

      // Then fetch products with the same type and compatible gender, excluding the current product
      const { data, error: fetchError, count } = await supabase
        .from('products')
        .select('*', { count: 'exact' })
        .eq('type', currentProduct.type)
        .or(`gender.eq.${currentProduct.gender},gender.eq.unisex`)
        .neq('id', productId)
        .limit(limit)
        .order('created_at', { ascending: false });

      if (fetchError) {
        throw fetchError;
      }

      // Transform the data to include computed fields
      const transformedProducts = (data || []).map(item => {
        const vibesArray = item.vibes && item.vibes !== 'nan' && item.vibes !== 'null' 
          ? item.vibes.split(',').map((v: string) => v.trim()).filter((v: string) => v && v !== 'nan' && v !== 'null')
          : [];
        
        const fitArray = item.fit && item.fit !== 'nan' && item.fit !== 'null' 
          ? item.fit.split(',').map((f: string) => f.trim()).filter((f: string) => f && f !== 'nan' && f !== 'null')
          : [];
        
        const feelArray = item.feel && item.feel !== 'nan' && item.feel !== 'null' 
          ? item.feel.split(',').map((f: string) => f.trim()).filter((f: string) => f && f !== 'nan' && f !== 'null')
          : [];

        return {
          ...item,
          vibesArray,
          fitArray,
          feelArray
        } as Product;
      });

      setSimilarProducts(transformedProducts);
      setTotalCount(count || 0);

    } catch (err) {
      console.error('Error fetching similar products:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch similar products');
    } finally {
      setLoading(false);
    }
  }, [productId, limit]);

  useEffect(() => {
    fetchSimilarProducts();
  }, [fetchSimilarProducts]);

  return {
    similarProducts,
    loading,
    error,
    totalCount
  };
}
