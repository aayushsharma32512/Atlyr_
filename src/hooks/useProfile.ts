import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Tables } from '@/integrations/supabase/types';
import { useSilhouettes } from '@/hooks/useSilhouettes';
import { useGuest } from '@/contexts/GuestContext';

type Profile = Tables<'profiles'>;
type ProfileInsert = Omit<Profile, 'id' | 'created_at' | 'updated_at'>;
type ProfileUpdate = Partial<Omit<Profile, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

export function useProfile() {
  const { user } = useAuth();
  // Singleton cache across all hook instances
  // Note: module scope ensures a single copy per bundle instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globalAny = globalThis as any;
  if (!globalAny.__profile_cache__) {
    globalAny.__profile_cache__ = { profile: null as Profile | null, loading: false, error: null as string | null, fetchedForUserId: null as string | null, inflight: false };
  }
  const cache = globalAny.__profile_cache__ as { profile: Profile | null; loading: boolean; error: string | null; fetchedForUserId: string | null; inflight: boolean };

  const [profile, setProfile] = useState<Profile | null>(cache.profile);
  const [loading, setLoading] = useState<boolean>(cache.loading);
  const [error, setError] = useState<string | null>(cache.error);
  // Cache silhouettes once per app lifetime to avoid per-card fetch storms
  let cachedSilhouettes: ReturnType<typeof useSilhouettes>['silhouettes'] | null = null;
  const { silhouettes } = useSilhouettes();
  if (!cachedSilhouettes && silhouettes && silhouettes.length > 0) {
    cachedSilhouettes = silhouettes;
  }
  const { guestState } = useGuest();

  useEffect(() => {
    if (!user) {
      cache.profile = null;
      cache.loading = false;
      cache.error = null;
      cache.fetchedForUserId = null;
      setProfile(null);
      setLoading(false);
      setError(null);
      return;
    }

    // If we have a cached profile for this user, reuse it
    if (cache.fetchedForUserId === user.id && cache.profile) {
      setProfile(cache.profile);
      setLoading(false);
      setError(cache.error);
      return;
    }

    // Prevent parallel fetches
    if (cache.inflight) {
      // Poll until inflight resolves; quick exit pattern to avoid complexity
      const id = setInterval(() => {
        if (!cache.inflight) {
          clearInterval(id);
          setProfile(cache.profile);
          setLoading(false);
          setError(cache.error);
        }
      }, 50);
      return;
    }

    fetchProfile();
  }, [user]);

  const fetchProfile = async () => {
    if (!user) return;

    try {
      cache.inflight = true;
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) {
        setError(error.message);
        cache.error = error.message;
      } else {
        setProfile(data);
        cache.profile = data;
        cache.fetchedForUserId = user.id;
        cache.error = null;
      }
    } catch (err) {
      setError('Failed to fetch profile');
      cache.error = 'Failed to fetch profile';
    } finally {
      cache.inflight = false;
      cache.loading = false;
      setLoading(false);
    }
  };

  const createProfile = async (profileData: Omit<ProfileInsert, 'user_id'>) => {
    if (!user) throw new Error('User not authenticated');

    try {
      const { data, error } = await supabase
        .from('profiles')
        .insert({
          ...profileData,
          user_id: user.id
        })
        .select()
        .single();

      if (error) throw error;
      
      setProfile(data);
      cache.profile = data;
      cache.error = null;
      cache.fetchedForUserId = user.id;
      return { data, error: null };
    } catch (err) {
      const error = err as Error;
      setError(error.message);
      return { data: null, error };
    }
  };

  const updateProfile = async (updates: ProfileUpdate) => {
    if (!user) throw new Error('User not authenticated');

    try {
      // First, check if profile exists
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      
      let data;
      let error;

      // If profile exists, update it
      if (existingProfile) {
        const response = await supabase
          .from('profiles')
          .update(updates)
          .eq('user_id', user.id)
          .select()
          .single();
        
        data = response.data;
        error = response.error;
      } 
      // If profile doesn't exist, create it
      else {
        const response = await supabase
          .from('profiles')
          .insert({
            ...updates as ProfileInsert,
            user_id: user.id
          })
          .select()
          .single();
        
        data = response.data;
        error = response.error;
      }

      if (error) throw error;
      
      setProfile(data);
      cache.profile = data;
      cache.error = null;
      cache.fetchedForUserId = user.id;
      return { data, error: null };
    } catch (err) {
      const error = err as Error;
      setError(error.message);
      return { data: null, error };
    }
  };

  const completeOnboarding = async () => {
    return updateProfile({ onboarding_complete: true });
  };

  const updatePreferredCategories = async (categories: string[]) => {
    return updateProfile({ preferred_categories: categories });
  };

  const completeOnboardingWithPreferences = async (silhouette: string, categories: string[]) => {
    return updateProfile({ 
      selected_silhouette: silhouette,
      preferred_categories: categories,
      onboarding_complete: true 
    });
  };

  // Avatar-related methods
  const updateAvatarSelections = async (
    faceShape: string, 
    skinTone: string, 
    hairstyle: string, 
    avatarId: string, 
    imageUrl: string, 
    scalingFactor: number
  ) => {
    return updateProfile({
      selected_face_shape: faceShape,
      selected_skin_tone: skinTone,
      selected_hairstyle: hairstyle,
      selected_avatar_id: avatarId,
      selected_avatar_image_url: imageUrl,
      selected_avatar_scaling_factor: scalingFactor
    });
  };

  const getCurrentAvatar = () => {
    if (!profile) return null;
    
    return {
      faceShape: profile.selected_face_shape,
      skinTone: profile.selected_skin_tone,
      hairstyle: profile.selected_hairstyle,
      avatarId: profile.selected_avatar_id,
      imageUrl: profile.selected_avatar_image_url,
      scalingFactor: profile.selected_avatar_scaling_factor
    };
  };

  const getAvatarScalingFactor = () => {
    if (profile?.selected_avatar_scaling_factor) return profile.selected_avatar_scaling_factor;
    if (guestState?.avatar?.scalingFactor) return guestState.avatar.scalingFactor;
    return 0.17; // Default fallback
  };

  // New helper functions for avatar migration
  const getUserAvatarUrl = () => {
    // Authenticated: use profile-first resolution
    if (profile) {
      if (profile.selected_avatar_image_url) return profile.selected_avatar_image_url;
      const pool = cachedSilhouettes ?? silhouettes;
      if (profile.selected_silhouette && pool.length > 0) {
        const silhouette = pool.find(s => s.id === profile.selected_silhouette);
        if (silhouette) return silhouette.imageUrl;
      }
    }
    // Guest fallback
    if (guestState?.avatar?.imageUrl) return guestState.avatar.imageUrl;
    return '/avatars/Default.png';
  };

  const getSelectedAvatarId = () => {
    if (profile?.selected_avatar_id) return profile.selected_avatar_id;
    if (guestState?.avatar?.headId) return guestState.avatar.headId;
    return null;
  };

  const getUserGender = (): 'male' | 'female' => {
    const profGender = profile?.gender === 'female' ? 'female' : profile?.gender === 'male' ? 'male' : null;
    if (profGender) return profGender;
    const guestGender = guestState?.avatar?.gender;
    return guestGender === 'female' ? 'female' : 'male';
  };

  const getUserHeightCm = (): number => {
    if (profile && (profile as any).height_cm && typeof (profile as any).height_cm === 'number') {
      return (profile as any).height_cm as number;
    }
    const guestHeight = guestState?.preferences && (guestState.preferences as any).heightCm;
    if (typeof guestHeight === 'number') return guestHeight as number;
    return 175;
  };

  const hasCompletedOnboarding = () => {
    return profile?.onboarding_complete === true;
  };

  const hasSelectedAvatar = () => {
    return !!(profile?.selected_avatar_image_url);
  };

  const completeOnboardingWithAvatar = async (
    faceShape: string, 
    skinTone: string, 
    hairstyle: string, 
    avatarId: string, 
    imageUrl: string, 
    scalingFactor: number,
    categories: string[]
  ) => {
    return updateProfile({
      selected_face_shape: faceShape,
      selected_skin_tone: skinTone,
      selected_hairstyle: hairstyle,
      selected_avatar_id: avatarId,
      selected_avatar_image_url: imageUrl,
      selected_avatar_scaling_factor: scalingFactor,
      preferred_categories: categories,
      onboarding_complete: true
    });
  };

  return {
    profile,
    loading,
    error,
    createProfile,
    updateProfile,
    completeOnboarding,
    updatePreferredCategories,
    completeOnboardingWithPreferences,
    // Avatar methods
    updateAvatarSelections,
    getCurrentAvatar,
    getAvatarScalingFactor,
    completeOnboardingWithAvatar,
    // New avatar helper functions
    getUserAvatarUrl,
    getSelectedAvatarId,
    getUserGender,
    getUserHeightCm,
    hasCompletedOnboarding,
    hasSelectedAvatar,
    refetch: fetchProfile
  };
}