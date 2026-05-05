-- Tracks copy lineage: when a user saves an outfit with the same product combo
-- as an existing outfit, source_outfit_id points to that original outfit.
-- Outfits with source_outfit_id IS NULL are "originals" and appear in public feeds.
-- Copies live only in the saving user's library/moodboard.

ALTER TABLE public.outfits
ADD COLUMN IF NOT EXISTS source_outfit_id UUID REFERENCES public.outfits(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.outfits.source_outfit_id
IS 'Non-null when this outfit is a copy of another (same top/bottom/shoes). Points to the source outfit. NULL = original, shown in public feed.';
