-- Backfill: existing outfits have source_outfit_id = NULL.
-- Set source_outfit_id = id for all existing rows so they are treated as originals
-- by the public feed filter (source_outfit_id = id).
-- Safe to run multiple times (WHERE clause guards against already-set rows).

UPDATE public.outfits
SET source_outfit_id = id
WHERE source_outfit_id IS NULL;
