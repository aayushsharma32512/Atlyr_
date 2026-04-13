-- Migration: Create avatar_heads table
-- This migration creates the avatar_heads table for storing all avatar combinations

-- Create avatar_heads table
CREATE TABLE public.avatar_heads (
  id TEXT PRIMARY KEY,
  gender TEXT NOT NULL,
  faceshape TEXT NOT NULL,
  skintone TEXT NOT NULL,
  hairstyle TEXT NOT NULL,
  image_url TEXT NOT NULL,
  scaling_factor DECIMAL(5,3) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Add indexes for efficient queries
CREATE INDEX idx_avatar_heads_gender ON avatar_heads(gender);
CREATE INDEX idx_avatar_heads_selection ON avatar_heads(faceshape, skintone, hairstyle, gender);
CREATE INDEX idx_avatar_heads_skin_hairstyle ON avatar_heads(skintone, hairstyle, gender);
CREATE INDEX idx_avatar_heads_face_hairstyle ON avatar_heads(faceshape, hairstyle, gender);

-- Enable Row Level Security
ALTER TABLE public.avatar_heads ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access
CREATE POLICY "Allow public read access to avatar_heads" ON public.avatar_heads
  FOR SELECT USING (true); 