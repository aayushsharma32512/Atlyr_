ALTER TABLE public.outfits ADD COLUMN IF NOT EXISTS tags text[];
ALTER TABLE public.user_favorites ADD COLUMN IF NOT EXISTS tags text[];

COMMENT ON COLUMN public.outfits.tags IS 'User-selected tags shown on the card.';
COMMENT ON COLUMN public.user_favorites.tags IS 'User-selected tags shown on the card.';
