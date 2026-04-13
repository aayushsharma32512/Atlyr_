import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Tables } from '@/integrations/supabase/types';

export interface CustomCategory {
  id: string;
  name: string;
  slug: string;
  isForYou: boolean; // Special flag for "For You" category
  isExploreMoods: boolean; // Special flag for "Explore Moods" category
}

export function useCustomCategories() {
  const [categories, setCategories] = useState<CustomCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    fetchCustomCategories();
  }, [user]);

  const fetchCustomCategories = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!user) {
        // If no user, return default categories with "For You" first
        const { data: allCategories, error: categoriesError } = await supabase
          .from('categories')
          .select('id, name, slug')
          .order('name');

        if (categoriesError) {
          throw new Error(`Failed to fetch categories: ${categoriesError.message}`);
        }

        const defaultCategories: CustomCategory[] = [
          { id: 'explore-moods', name: 'Explore Moods', slug: 'explore-moods', isForYou: false, isExploreMoods: true },
          { id: 'for-you', name: 'For You', slug: 'for-you', isForYou: true, isExploreMoods: false },
          ...(allCategories || []).map(cat => ({
            id: cat.id,
            name: cat.name,
            slug: cat.slug,
            isForYou: false,
            isExploreMoods: false
          }))
        ];

        setCategories(defaultCategories);
        return;
      }

      // Fetch user's profile to get preferred categories
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('preferred_categories')
        .eq('user_id', user.id)
        .single();

      if (profileError) {
        throw new Error(`Failed to fetch user profile: ${profileError.message}`);
      }

      // Fetch all categories
      const { data: allCategories, error: categoriesError } = await supabase
        .from('categories')
        .select('id, name, slug')
        .order('name');

      if (categoriesError) {
        throw new Error(`Failed to fetch categories: ${categoriesError.message}`);
      }

      // Build custom category order
      const customCategories: CustomCategory[] = [];

      // 1. Always add "Explore Moods" first
      customCategories.push({
        id: 'explore-moods',
        name: 'Explore Moods',
        slug: 'explore-moods',
        isForYou: false,
        isExploreMoods: true
      });

      // 2. Always add "For You" second
      customCategories.push({
        id: 'for-you',
        name: 'For You',
        slug: 'for-you',
        isForYou: true,
        isExploreMoods: false
      });

      // 3. Add user's preferred categories alphabetically
      const preferredCategoryIds = profile?.preferred_categories || [];
      const preferredCategories = (allCategories || [])
        .filter(cat => preferredCategoryIds.includes(cat.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(cat => ({
          id: cat.id,
          name: cat.name,
          slug: cat.slug,
          isForYou: false,
          isExploreMoods: false
        }));

      customCategories.push(...preferredCategories);

      setCategories(customCategories);
    } catch (err) {
      console.error('Error fetching custom categories:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  return {
    categories,
    loading,
    error,
    refetch: fetchCustomCategories
  };
} 