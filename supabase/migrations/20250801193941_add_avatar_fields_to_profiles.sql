-- Migration: Add avatar fields to profiles table
-- This migration adds avatar selection fields to the profiles table

-- Add new avatar fields to profiles table
ALTER TABLE public.profiles 
ADD COLUMN selected_avatar_id TEXT,
ADD COLUMN selected_face_shape TEXT,
ADD COLUMN selected_skin_tone TEXT,
ADD COLUMN selected_hairstyle TEXT,
ADD COLUMN selected_avatar_image_url TEXT,
ADD COLUMN selected_avatar_scaling_factor DECIMAL(5,3) DEFAULT 0.170;

-- Add foreign key constraint to avatar_heads table
ALTER TABLE public.profiles 
ADD CONSTRAINT fk_profiles_avatar_heads 
FOREIGN KEY (selected_avatar_id) REFERENCES public.avatar_heads(id);

-- Add index for efficient avatar lookups
CREATE INDEX idx_profiles_avatar_id ON profiles(selected_avatar_id);

-- Add index for avatar selection queries
CREATE INDEX idx_profiles_avatar_selection ON profiles(selected_face_shape, selected_skin_tone, selected_hairstyle); 