import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../integrations/supabase/client';
import { Product, ProductImage } from '../types';

interface UseProductsOptions {
  // legacy single-value filters
  gender?: 'male' | 'female' | 'unisex';
  category?: string;
  // new multi-select filters
  genders?: Array<'male' | 'female' | 'unisex'>;
  typeCategories?: string[];
  brands?: string[];
  fits?: string[];
  feels?: string[];
  colorGroups?: string[];
  sizes?: string[];
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
  searchQuery?: string;
}

interface UseProductsReturn {
  products: Product[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// Type for the database response
interface ProductWithImages {
  id: string;
  brand: string;
  product_name: string | null;
  price: number;
  currency: string;
  description: string;
  color: string;
  color_group: string | null;
  gender: 'male' | 'female' | 'unisex' | null;
  size: string;
  type: 'top' | 'bottom' | 'shoes' | 'accessory' | 'occasion';
  category_id: string | null;
  vibes: string | null;
  fit: string | null;
  feel: string | null;
  image_url: string;
  product_url: string | null;
  placement_x: number | null;
  placement_y: number | null;
  image_length: number | null;
  product_length: number | null;
  type_category: string | null;
  created_at: string;
  updated_at: string;
}

export function useProducts(options: UseProductsOptions = {}): UseProductsReturn {
  const { gender, category, genders, typeCategories, brands, fits, feels, colorGroups, sizes, minPrice, maxPrice, limit = 20, searchQuery } = options;
  
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Client-side infinite scroll: fetch all matching products at once

  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('products')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      // Gender filters (multi-select takes precedence if provided)
      if (genders && genders.length > 0) {
        query = query.in('gender', genders);
      } else if (gender) {
        query = query.eq('gender', gender);
      }
      
      if (category) {
        query = query.eq('category_id', category);
      }

      if (typeCategories && typeCategories.length > 0) {
        query = query.in('type_category', typeCategories);
      }

      if (brands && brands.length > 0) {
        query = query.in('brand', brands);
      }

      if (fits && fits.length > 0) {
        query = query.in('fit', fits);
      }

      if (feels && feels.length > 0) {
        query = query.in('feel', feels);
      }

      if (colorGroups && colorGroups.length > 0) {
        query = query.in('color_group', colorGroups);
      }

      if (sizes && sizes.length > 0) {
        query = query.in('size', sizes);
      }

      if (typeof minPrice === 'number') {
        query = query.gte('price', minPrice);
      }

      if (typeof maxPrice === 'number') {
        query = query.lte('price', maxPrice);
      }

      if (searchQuery) {
        query = query.or(`product_name.ilike.%${searchQuery}%,brand.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`);
      }

      // Fetch all rows (Supabase default cap applies, which is acceptable for client-side paging here)
      const { data, error: fetchError } = await query;

      if (fetchError) {
        setError(fetchError.message);
        return;
      }

      // Transform the data to match our Product interface
      const transformedProducts: Product[] = (data || []).map((item: any) => {
        // Parse vibes, fit, feel into arrays for UI display
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
          feelArray,
        };
      });

      setProducts(transformedProducts);

    } catch (err) {
      console.error('Error fetching products:', err);
      setError('Failed to load products.');
    } finally {
      setLoading(false);
    }
  }, [gender, genders, category, typeCategories, brands, fits, feels, colorGroups, sizes, minPrice, maxPrice, limit, searchQuery]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const refetch = useCallback(() => {
    // keep current products to avoid flicker; just trigger a fresh fetch
    fetchProducts();
  }, [fetchProducts]);

  return {
    products,
    loading,
    error,
    refetch,
  };
}
