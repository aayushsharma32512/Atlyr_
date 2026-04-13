-- Migration: Add placement_x and placement_y to avatar_heads

-- Add columns if not exist to avoid errors on re-run
ALTER TABLE public.avatar_heads
  ADD COLUMN IF NOT EXISTS placement_x DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS placement_y DOUBLE PRECISION;

-- Optional: backfill defaults (null means use component defaults in app)
-- UPDATE public.avatar_heads SET placement_x = 0.0 WHERE placement_x IS NULL;
-- UPDATE public.avatar_heads SET placement_y = 0.0 WHERE placement_y IS NULL;

-- Indexes are not required for simple numeric attributes used only for rendering,
-- so we skip creating additional indexes here.


