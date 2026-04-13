import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Product } from '@/types';

interface UseComplementaryProductsReturn {
  complementaryProducts: Product[];
  loading: boolean;
  error: string | null;
  totalCount: number;
}

export function useComplementaryProducts(productId?: string, limit: number = 50): UseComplementaryProductsReturn {
  const [complementaryProducts, setComplementaryProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  const fetchComplementaryProducts = useCallback(async () => {
    if (!productId) {
      setComplementaryProducts([]);
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

      // Determine complementary types based on current product type
      let complementaryTypes: ('top' | 'bottom' | 'shoes')[] = [];
      
      if (currentProduct.type === 'top') {
        complementaryTypes = ['bottom', 'shoes'];
      } else if (currentProduct.type === 'bottom') {
        complementaryTypes = ['top', 'shoes'];
      } else if (currentProduct.type === 'shoes') {
        complementaryTypes = ['top', 'bottom'];
      } else {
        // For other types, just exclude the current type
        complementaryTypes = (['top', 'bottom', 'shoes'] as const).filter(type => type !== currentProduct.type);
      }

      // Fetch complementary products with same gender or unisex
      const { data, error: fetchError, count } = await supabase
        .from('products')
        .select('*', { count: 'exact' })
        .in('type', complementaryTypes)
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

      setComplementaryProducts(transformedProducts);
      setTotalCount(count || 0);

    } catch (err) {
      console.error('Error fetching complementary products:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch complementary products');
    } finally {
      setLoading(false);
    }
  }, [productId, limit]);

  useEffect(() => {
    fetchComplementaryProducts();
  }, [fetchComplementaryProducts]);

  return {
    complementaryProducts,
    loading,
    error,
    totalCount
  };
}
