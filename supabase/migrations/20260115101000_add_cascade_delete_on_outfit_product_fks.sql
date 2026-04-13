-- Migration: Add cascade delete on outfit product foreign keys
-- Purpose: Delete outfits automatically when referenced products are deleted.

ALTER TABLE public.outfits
  DROP CONSTRAINT IF EXISTS outfits_top_id_fkey;

ALTER TABLE public.outfits
  DROP CONSTRAINT IF EXISTS outfits_bottom_id_fkey;

ALTER TABLE public.outfits
  DROP CONSTRAINT IF EXISTS outfits_shoes_id_fkey;

ALTER TABLE public.outfits
  ADD CONSTRAINT outfits_top_id_fkey
    FOREIGN KEY (top_id) REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE public.outfits
  ADD CONSTRAINT outfits_bottom_id_fkey
    FOREIGN KEY (bottom_id) REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE public.outfits
  ADD CONSTRAINT outfits_shoes_id_fkey
    FOREIGN KEY (shoes_id) REFERENCES public.products(id) ON DELETE CASCADE;
