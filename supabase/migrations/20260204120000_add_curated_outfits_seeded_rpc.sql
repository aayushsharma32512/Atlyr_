-- Create RPC for curated outfit IDs ordered by a deterministic seed-based hash.
-- This keeps pagination stable while still appearing random to users.

CREATE OR REPLACE FUNCTION public.get_curated_outfit_ids_seeded(
  p_gender TEXT,
  p_seed TEXT,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (id TEXT)
LANGUAGE sql
AS $$
  SELECT o.id
  FROM public.outfits o
  WHERE o.visible_in_feed = true
    AND o.category <> 'others'
    AND o.gender IS NOT NULL
    AND (
      o.gender = 'unisex'
      OR (p_gender IS NOT NULL AND o.gender = p_gender)
    )
  ORDER BY md5(o.id::text || coalesce(p_seed, '')) ASC, o.id ASC
  LIMIT COALESCE(p_limit, 50)
  OFFSET GREATEST(p_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION public.get_curated_outfit_ids_seeded(TEXT, TEXT, INT, INT) TO authenticated, anon;

COMMENT ON FUNCTION public.get_curated_outfit_ids_seeded(TEXT, TEXT, INT, INT)
IS 'Returns curated outfit IDs ordered by a deterministic hash of outfit id + seed, for stable randomized pagination.';
