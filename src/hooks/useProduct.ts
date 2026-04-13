import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Product } from '@/types';

export function useProduct(productId?: string) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (productId) {
      fetchProduct(productId);
    } else {
      setLoading(false);
    }
  }, [productId]);

  const fetchProduct = async (id: string) => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: productError } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single();

      if (productError) throw productError;

      if (data) {
        // Transform the data to include computed fields
        const vibesArray = data.vibes && data.vibes !== 'nan' && data.vibes !== 'null' 
          ? data.vibes.split(',').map((v: string) => v.trim()).filter((v: string) => v && v !== 'nan' && v !== 'null')
          : [];
        
        const fitArray = data.fit && data.fit !== 'nan' && data.fit !== 'null' 
          ? data.fit.split(',').map((f: string) => f.trim()).filter((f: string) => f && f !== 'nan' && f !== 'null')
          : [];
        
        const feelArray = data.feel && data.feel !== 'nan' && data.feel !== 'null' 
          ? data.feel.split(',').map((f: string) => f.trim()).filter((f: string) => f && f !== 'nan' && f !== 'null')
          : [];

        const transformedProduct: Product = {
          ...data,
          gender: (data.gender === 'male' || data.gender === 'female' || data.gender === 'unisex') 
            ? data.gender as 'male' | 'female' | 'unisex'
            : null,
          vibesArray,
          fitArray,
          feelArray
        };

        setProduct(transformedProduct);
      } else {
        setError('Product not found');
      }
    } catch (err) {
      console.error('Error fetching product:', err);
      setError('Failed to fetch product');
    } finally {
      setLoading(false);
    }
  };

  return {
    product,
    loading,
    error,
    refetch: fetchProduct
  };
} 