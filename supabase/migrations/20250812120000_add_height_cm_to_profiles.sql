-- Migration: Add height_cm to profiles for height-based visualization

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS height_cm INTEGER;

-- Optional: Documentation
COMMENT ON COLUMN public.profiles.height_cm IS 'User height in centimeters used for proportional avatar/item scaling';


