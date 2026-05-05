-- Tracks copy lineage: source_outfit_id = outfit's own id means it's an original.
-- source_outfit_id = another outfit's id means it's a copy of that outfit.
-- Plain UUID — no FK constraint (avoids self-referential issues, simpler).
-- Public feed RPCs filter: source_outfit_id = id (originals only).

-- Drop FK constraint if it was previously applied with REFERENCES
ALTER TABLE public.outfits
DROP CONSTRAINT IF EXISTS outfits_source_outfit_id_fkey;

-- Add column as plain UUID (no FK)
ALTER TABLE public.outfits
ADD COLUMN IF NOT EXISTS source_outfit_id UUID;

COMMENT ON COLUMN public.outfits.source_outfit_id
IS 'source_outfit_id = id → original, shown in public feed. source_outfit_id ≠ id → copy of that outfit, hidden from public feed, visible only in owner library.';
