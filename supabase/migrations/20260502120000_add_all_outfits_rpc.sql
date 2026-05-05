-- RPC to fetch all visible outfit IDs with configurable sort order.
-- Used by the "All Outfits" tab. Unlike the curated seeded version,
-- results are deterministic and stable across pagination.
-- Deduplicates by (top_id, bottom_id, shoes_id) — same combo = data quality issue,
-- keeps highest-rated, newest as tiebreaker.
-- Only shows originals (source_outfit_id IS NULL) and non-private outfits.

CREATE OR REPLACE FUNCTION public.get_all_outfit_ids(
  p_gender TEXT,
  p_sort_by TEXT DEFAULT 'newly_added',
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
  ORDER BY
    CASE WHEN p_sort_by = 'relevance' THEN deduped.rating END DESC NULLS LAST,
    CASE WHEN p_sort_by != 'relevance' THEN deduped.created_at END DESC NULLS LAST,
    deduped.id DESC
  LIMIT COALESCE(p_limit, 50)
  OFFSET GREATEST(p_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION public.get_all_outfit_ids(TEXT, TEXT, INT, INT) TO authenticated, anon;

COMMENT ON FUNCTION public.get_all_outfit_ids(TEXT, TEXT, INT, INT)
IS 'Returns deduplicated original outfit IDs (source_outfit_id IS NULL, is_private = false), sorted by relevance or newly_added. Gender-aware.';
