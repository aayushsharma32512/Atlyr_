import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getDefaultHairstyle, getHairstyleSortOrder, sortByCustomOrder, APP_CONSTANTS } from '@/utils/constants';

export interface AvatarHead {
  id: string;
  gender: string;
  faceshape: string;
  skintone: string;
  hairstyle: string;
  image_url: string;
  scaling_factor: number;
  created_at: string;
}

export function useAvatarHeads() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get face shapes for Step 1 (using predefined skin tone and hairstyle)
  const getFaceShapes = useCallback(async (gender: string = 'male', skinTone: string = 'light', hairstyle?: string) => {
    try {
      setLoading(true);
      setError(null);

      // Use gender-specific default hairstyle if not provided
      const defaultHairstyle = hairstyle || getDefaultHairstyle(gender);

      console.log('🔍 getFaceShapes called with:', { gender, skinTone, defaultHairstyle });

      // Get distinct face shapes with the specified criteria
      const { data, error: queryError } = await supabase
        .from('avatar_heads')
        .select('faceshape, image_url')
        .eq('gender', gender)
        .eq('skintone', skinTone)
        .eq('hairstyle', defaultHairstyle)
        .order('faceshape');

      console.log('📊 Raw database response:', data);
      console.log('❌ Query error:', queryError);

      if (queryError) throw queryError;

      // Remove duplicates and map to display format
      const uniqueFaceShapes = data?.reduce((acc, item) => {
        if (!acc.find(existing => existing.id === item.faceshape)) {
          acc.push({
            id: item.faceshape,
            name: item.faceshape,
            image_url: item.image_url,
            description: `${item.faceshape} face shape`
          });
        }
        return acc;
      }, [] as Array<{
        id: string;
        name: string;
        image_url: string;
        description: string;
      }>) || [];

      console.log('🎯 Processed face shapes:', uniqueFaceShapes);

      return uniqueFaceShapes;
    } catch (err) {
      console.error('Error fetching face shapes:', err);
      setError('Failed to fetch face shapes');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Get skin tones for Step 2 (using selected face shape and predefined hairstyle)
  const getSkinTones = useCallback(async (gender: string = 'male', faceShape: string, hairstyle?: string) => {
    try {
      setLoading(true);
      setError(null);

      // Use gender-specific default hairstyle if not provided
      const defaultHairstyle = hairstyle || getDefaultHairstyle(gender);

      console.log('🔍 getSkinTones called with:', { gender, faceShape, defaultHairstyle });

      // Get distinct skin tones with the specified criteria
      const { data, error: queryError } = await supabase
        .from('avatar_heads')
        .select('skintone, image_url')
        .eq('gender', gender)
        .eq('faceshape', faceShape)
        .eq('hairstyle', defaultHairstyle)
        .order('skintone');

      console.log('📊 Raw skin tones response:', data);
      console.log('❌ Skin tones query error:', queryError);

      if (queryError) throw queryError;

      // Remove duplicates and map to display format
      const uniqueSkinTones = data?.reduce((acc, item) => {
        if (!acc.find(existing => existing.id === item.skintone)) {
          acc.push({
            id: item.skintone,
            name: item.skintone,
            image_url: item.image_url,
            description: `${item.skintone} skin tone`
          });
        }
        return acc;
      }, [] as Array<{
        id: string;
        name: string;
        image_url: string;
        description: string;
      }>) || [];

      // Apply custom sorting for skin tones
      const sortedSkinTones = sortByCustomOrder(uniqueSkinTones, APP_CONSTANTS.AVATAR.SKINTONE_SORT_ORDER);

      console.log('🎯 Processed skin tones:', sortedSkinTones);

      return sortedSkinTones;
    } catch (err) {
      console.error('Error fetching skin tones:', err);
      setError('Failed to fetch skin tones');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Get hairstyles for Step 3 (using selected face shape and skin tone)
  const getHairstyles = useCallback(async (gender: string = 'male', faceShape: string, skinTone: string) => {
    try {
      setLoading(true);
      setError(null);

      // Get all hairstyles with the specified criteria (these are complete avatars)
      const { data, error: queryError } = await supabase
        .from('avatar_heads')
        .select('*')
        .eq('gender', gender)
        .eq('faceshape', faceShape)
        .eq('skintone', skinTone)
        .order('hairstyle');

      if (queryError) throw queryError;

      // Map to display format with complete avatar data
      const hairstyles = data?.map(item => ({
        id: item.hairstyle,
        name: item.hairstyle,
        image_url: item.image_url,
        description: `${item.hairstyle} hairstyle`,
        avatar_id: item.id,
        scaling_factor: item.scaling_factor
      })) || [];

      // Apply custom sorting for hairstyles
      const genderHairstyleOrder = getHairstyleSortOrder(gender);
      const sortedHairstyles = sortByCustomOrder(hairstyles, genderHairstyleOrder);

      return sortedHairstyles;
    } catch (err) {
      console.error('Error fetching hairstyles:', err);
      setError('Failed to fetch hairstyles');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Get final avatar by complete selection
  const getAvatarBySelection = useCallback(async (gender: string, faceShape: string, skinTone: string, hairstyle: string) => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: queryError } = await supabase
        .from('avatar_heads')
        .select('*')
        .eq('gender', gender)
        .eq('faceshape', faceShape)
        .eq('skintone', skinTone)
        .eq('hairstyle', hairstyle)
        .single();

      if (queryError) throw queryError;

      return data;
    } catch (err) {
      console.error('Error fetching avatar by selection:', err);
      setError('Failed to fetch avatar');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    getFaceShapes,
    getSkinTones,
    getHairstyles,
    getAvatarBySelection
  };
} 