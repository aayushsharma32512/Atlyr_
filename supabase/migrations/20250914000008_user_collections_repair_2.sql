-- Repair 2: finalize get_user_collections to include system slugs with correct counts
-- and avoid ambiguous created_at. This file is safe to apply after previous repairs.

-- 1) Drop old signature to allow OUT parameter changes
DROP FUNCTION IF EXISTS public.get_user_collections(UUID);

-- 2) Recreate RPC with disambiguated timestamp and system slugs union
CREATE OR REPLACE FUNCTION public.get_user_collections(p_user_id UUID DEFAULT auth.uid())
RETURNS TABLE (
  collection_slug TEXT,
  collection_label TEXT,
  item_count BIGINT,
  is_system BOOLEAN,
  collection_created_at TIMESTAMPTZ
) AS $$
DECLARE
  reserved_slugs TEXT[] := ARRAY['favorites','generations'];
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT slug AS collection_slug, label AS collection_label, created_at
    FROM public.user_collections
    WHERE user_id = p_user_id
  ),
  sys AS (
    SELECT 'favorites'::text AS collection_slug, 'Favorites'::text AS collection_label,
           MIN(uf.created_at) AS created_at
    FROM public.user_favorites uf
    WHERE uf.user_id = p_user_id AND LOWER(uf.collection_slug) = 'favorites'
    UNION ALL
    SELECT 'generations'::text, 'Generations'::text,
           MIN(uf.created_at) AS created_at
    FROM public.user_favorites uf
    WHERE uf.user_id = p_user_id AND LOWER(uf.collection_slug) = 'generations'
  ),
  allc AS (
    SELECT * FROM base
    UNION
    SELECT * FROM sys
  )
  SELECT 
    b.collection_slug,
    b.collection_label,
    COALESCE(COUNT(uf.outfit_id), 0) AS item_count,
    (b.collection_slug = ANY(reserved_slugs)) AS is_system,
    MIN(b.created_at) AS collection_created_at
  FROM allc b
  LEFT JOIN public.user_favorites uf
    ON uf.user_id = p_user_id AND LOWER(uf.collection_slug) = LOWER(b.collection_slug)
  GROUP BY b.collection_slug, b.collection_label
  ORDER BY CASE WHEN b.collection_slug = ANY(reserved_slugs) THEN 0 ELSE 1 END,
           b.collection_label;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_user_collections TO authenticated, anon;

