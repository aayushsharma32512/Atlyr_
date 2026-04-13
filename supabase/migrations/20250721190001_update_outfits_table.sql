-- Migration: Update outfits table structure for new product requirements

-- 1. Remove columns
ALTER TABLE public.outfits DROP COLUMN IF EXISTS total_price;
ALTER TABLE public.outfits DROP COLUMN IF EXISTS currency;

-- 2. Rename columns
ALTER TABLE public.outfits RENAME COLUMN occasion_background TO occasion;
ALTER TABLE public.outfits RENAME COLUMN selected_background TO background_id;

-- 3. Add new columns
ALTER TABLE public.outfits ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE public.outfits ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE public.outfits ADD COLUMN IF NOT EXISTS fit TEXT;
ALTER TABLE public.outfits ADD COLUMN IF NOT EXISTS feel TEXT;
ALTER TABLE public.outfits ADD COLUMN IF NOT EXISTS word_association TEXT;
ALTER TABLE public.outfits ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.outfits ADD COLUMN IF NOT EXISTS outfit_match TEXT;
ALTER TABLE public.outfits ADD COLUMN IF NOT EXISTS visible_in_feed BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.outfits ADD COLUMN IF NOT EXISTS popularity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.outfits ADD COLUMN IF NOT EXISTS rating FLOAT NOT NULL DEFAULT 0;

-- 4. Add foreign key for outfit_match (reference to outfits.id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'outfits_outfit_match_fkey' AND table_name = 'outfits'
  ) THEN
    ALTER TABLE public.outfits ADD CONSTRAINT outfits_outfit_match_fkey FOREIGN KEY (outfit_match) REFERENCES public.outfits(id) ON DELETE SET NULL;
  END IF;
END $$; 
