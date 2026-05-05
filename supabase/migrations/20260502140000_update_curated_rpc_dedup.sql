-- Update get_curated_outfit_ids_seeded to match All Outfits dedup and filter rules:
-- only originals (source_outfit_id IS NULL), non-private, deduplicated by product combo.

CREATE OR REPLACE FUNCTION public.get_curated_outfit_ids_seeded(
  p_gender TEXT,
  p_seed TEXT,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (id TEXT)
LANGUAGE sql
AS $$
  SELECT deduped.id
  FROM (
    SELECT DISTINCT ON (o.top_id, o.bottom_id, o.shoes_id)
      o.id,
      o.rating,
      o.created_at
    FROM public.outfits o
    WHERE o.visible_in_feed = true
      AND o.is_private = false
      AND o.source_outfit_id IS NULL
      AND o.category <> 'others'
      AND o.gender IS NOT NULL
      AND (
        o.gender = 'unisex'
        OR (p_gender IS NOT NULL AND o.gender = p_gender)
      )
    ORDER BY
      o.top_id,
      o.bottom_id,
      o.shoes_id,
      o.rating DESC NULLS LAST,
      o.created_at DESC
  ) deduped
  ORDER BY md5(deduped.id::text || coalesce(p_seed, '')) ASC, deduped.id ASC
  LIMIT COALESCE(p_limit, 50)
  OFFSET GREATEST(p_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION public.get_curated_outfit_ids_seeded(TEXT, TEXT, INT, INT) TO authenticated, anon;

COMMENT ON FUNCTION public.get_curated_outfit_ids_seeded(TEXT, TEXT, INT, INT)
IS 'Returns deduplicated original outfit IDs in stable seed-based random order. Filters: source_outfit_id IS NULL, is_private = false, gender-aware, excludes others category.';
