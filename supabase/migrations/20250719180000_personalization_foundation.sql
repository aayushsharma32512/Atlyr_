-- Migration: Personalization Foundation
-- This migration creates the database foundation for personalization features

-- Step 1: Extend profiles table with onboarding fields (only add missing fields)
ALTER TABLE public.profiles 
ADD COLUMN themes JSONB DEFAULT '[]',
ADD COLUMN gender TEXT CHECK (gender IN ('male', 'female', 'other'));

-- Add date_of_birth column for onboarding
ALTER TABLE public.profiles 
ADD COLUMN date_of_birth DATE;

-- Update gender constraint to allow new options
ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS profiles_gender_check,
ADD CONSTRAINT profiles_gender_check CHECK (gender IN ('male', 'female', 'lgbtqia+', 'prefer_not_to_say'));

-- Note: age and city already exist in profiles table, so we don't add them again
-- Note: selected_silhouette already exists and serves the same purpose as avatar_id

-- Step 2: Create user_interactions table for Layer 1 personalization
CREATE TABLE public.user_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  outfit_id TEXT NOT NULL REFERENCES public.outfits(id) ON DELETE CASCADE,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN ('favorite_add', 'favorite_remove', 'studio_open', 'cart_add', 'share', 'remix_click', 'element_change', 'category_click', 'search_query', 'filter_usage', 'load_more', 'studio_time')),
  category TEXT NOT NULL REFERENCES public.categories(id),
  weight INTEGER NOT NULL CHECK (weight >= 1 AND weight <= 15),
  metadata JSONB DEFAULT '{}', -- Store additional data like view_time, search_query, etc.
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Step 3: Create global_metrics table for Layer 4 fallback
CREATE TABLE public.global_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outfit_id TEXT NOT NULL REFERENCES public.outfits(id) ON DELETE CASCADE,
  total_saves INTEGER DEFAULT 0,
  total_studio_opens INTEGER DEFAULT 0,
  total_views INTEGER DEFAULT 0,
  total_shares INTEGER DEFAULT 0,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(outfit_id)
);

-- Step 4: Create outfit_hashes table for studio analytics
CREATE TABLE public.outfit_hashes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hash_id TEXT NOT NULL, -- SHA-256 hash of outfit components
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL, -- Studio session identifier
  originating_outfit_id TEXT REFERENCES public.outfits(id) ON DELETE SET NULL,
  outfit_components JSONB NOT NULL, -- Full component data for analytics
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(hash_id, user_id, session_id) -- Prevent duplicates per session
);

-- Step 5: Create indexes for performance
CREATE INDEX idx_user_interactions_user_id ON public.user_interactions(user_id);
CREATE INDEX idx_user_interactions_outfit_id ON public.user_interactions(outfit_id);
CREATE INDEX idx_user_interactions_type ON public.user_interactions(interaction_type);
CREATE INDEX idx_user_interactions_created_at ON public.user_interactions(created_at);
CREATE INDEX idx_user_interactions_user_type ON public.user_interactions(user_id, interaction_type);

CREATE INDEX idx_global_metrics_outfit_id ON public.global_metrics(outfit_id);
CREATE INDEX idx_global_metrics_saves ON public.global_metrics(total_saves DESC);
CREATE INDEX idx_global_metrics_studio_opens ON public.global_metrics(total_studio_opens DESC);

CREATE INDEX idx_outfit_hashes_user_id ON public.outfit_hashes(user_id);
CREATE INDEX idx_outfit_hashes_hash_id ON public.outfit_hashes(hash_id);
CREATE INDEX idx_outfit_hashes_session_id ON public.outfit_hashes(session_id);
CREATE INDEX idx_outfit_hashes_originating_outfit ON public.outfit_hashes(originating_outfit_id);

-- Add indexes for new profile fields
CREATE INDEX idx_profiles_themes ON public.profiles USING GIN (themes);
CREATE INDEX idx_profiles_gender_age ON public.profiles(gender, age);

-- Step 6: Enable RLS on new tables
ALTER TABLE public.user_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outfit_hashes ENABLE ROW LEVEL SECURITY;

-- Step 7: Create RLS policies
-- User interactions: Users can only see their own interactions
CREATE POLICY "Users can view their own interactions" ON public.user_interactions 
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own interactions" ON public.user_interactions 
FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Global metrics: Read-only for all authenticated users
CREATE POLICY "Global metrics are viewable by all" ON public.global_metrics 
FOR SELECT TO anon, authenticated USING (true);

-- Outfit hashes: Users can only see their own hashes
CREATE POLICY "Users can view their own outfit hashes" ON public.outfit_hashes 
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own outfit hashes" ON public.outfit_hashes 
FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Step 8: Create functions for personalization scoring
CREATE OR REPLACE FUNCTION public.calculate_recency_factor(days_since INTEGER)
RETURNS FLOAT AS $$
BEGIN
  RETURN 1.0 / (days_since + 1);
END;
$$ LANGUAGE plpgsql;

-- Function to calculate personalization score for an outfit
CREATE OR REPLACE FUNCTION public.calculate_outfit_score(
  p_user_id UUID,
  p_outfit_id TEXT,
  p_days_limit INTEGER DEFAULT 30
)
RETURNS FLOAT AS $$
DECLARE
  total_score FLOAT := 0;
  interaction_record RECORD;
BEGIN
  -- Calculate score from user interactions
  FOR interaction_record IN 
    SELECT weight, created_at
    FROM public.user_interactions 
    WHERE user_id = p_user_id 
      AND outfit_id = p_outfit_id
      AND created_at >= now() - (p_days_limit || ' days')::INTERVAL
  LOOP
    total_score := total_score + (
      interaction_record.weight * 
      public.calculate_recency_factor(
        EXTRACT(DAYS FROM (now() - interaction_record.created_at))::INTEGER
      )
    );
  END LOOP;
  
  RETURN total_score;
END;
$$ LANGUAGE plpgsql;

-- Step 9: Global metrics will be updated via application logic later
-- Removed trigger to avoid RLS issues for now

-- Step 10: Initialize global metrics for existing outfits
INSERT INTO public.global_metrics (outfit_id, total_saves, total_studio_opens, total_views, total_shares)
SELECT id, 0, 0, 0, 0 FROM public.outfits
ON CONFLICT (outfit_id) DO NOTHING; 