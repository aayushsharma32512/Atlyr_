-- Migration: Add head_to_body_ratio to profiles

-- Add a nullable FLOAT/DOUBLE PRECISION column with default 1.00
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS head_to_body_ratio DOUBLE PRECISION DEFAULT 1.0;

-- Optional documentation
COMMENT ON COLUMN public.profiles.head_to_body_ratio IS 'Per-user head/body scaling multiplier (1.0 = no change).';


