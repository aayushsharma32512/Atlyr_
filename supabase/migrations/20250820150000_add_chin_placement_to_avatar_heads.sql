-- Migration: Add chin_placement column to avatar_heads
-- Purpose: Store the chin position as a percentage from the bottom of the head image
-- Example: chin_placement = 15 means the chin lies 15% above the bottom edge

ALTER TABLE IF EXISTS public.avatar_heads
  ADD COLUMN IF NOT EXISTS chin_placement FLOAT;

COMMENT ON COLUMN public.avatar_heads.chin_placement IS 'Percentage (0-100) from bottom of head image up to the chin. Used as vertical origin for item placement.';
