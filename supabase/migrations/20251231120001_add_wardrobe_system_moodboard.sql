-- Add wardrobe system moodboard defaults + RPC updates

-- Update collections_meta defaults (only when unset or still using legacy defaults)
UPDATE profiles
SET collections_meta = '{
  "order": ["wardrobe", "try-ons", "favorites", "for-you"],
  "wardrobe": { "label": "Wardrobe", "isSystem": true },
  "try-ons": { "label": "Try-ons", "isSystem": true },
  "favorites": { "label": "Favorites", "isSystem": true },
  "for-you": { "label": "For You", "isSystem": true }
}'::jsonb
WHERE collections_meta IS NULL
  OR collections_meta->'order' = '["favorites", "try-ons", "for-you"]'::jsonb
  OR collections_meta->'order' = '["favorites", "generations"]'::jsonb;

ALTER TABLE profiles
  ALTER COLUMN collections_meta
  SET DEFAULT '{
    "order": ["wardrobe", "try-ons", "favorites", "for-you"],
    "wardrobe": { "label": "Wardrobe", "isSystem": true },
    "try-ons": { "label": "Try-ons", "isSystem": true },
    "favorites": { "label": "Favorites", "isSystem": true },
    "for-you": { "label": "For You", "isSystem": true }
  }'::jsonb;

-- Include wardrobe in reserved/system collections for management
CREATE OR REPLACE FUNCTION public.manage_collection(
  p_operation TEXT,
  p_collection_slug TEXT,
  p_collection_label TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
  reserved_slugs TEXT[] := ARRAY['favorites','generations','wardrobe'];
  normalized_slug TEXT := LOWER(p_collection_slug);
BEGIN
  IF p_operation NOT IN ('create','rename','delete') THEN
    RAISE EXCEPTION 'Invalid operation: %', p_operation;
  END IF;
  IF normalized_slug = ANY(reserved_slugs) THEN
    RAISE EXCEPTION 'Cannot % reserved collection: %', p_operation, normalized_slug;
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  IF p_operation = 'create' THEN
    INSERT INTO public.user_collections (user_id, slug, label)
    VALUES (p_user_id, normalized_slug, COALESCE(p_collection_label, INITCAP(normalized_slug)));
    result := jsonb_build_object('success', true, 'operation','create', 'collection_slug', normalized_slug);
  ELSIF p_operation = 'rename' THEN
    UPDATE public.user_collections
      SET label = COALESCE(p_collection_label, label)
      WHERE user_id = p_user_id AND slug = normalized_slug;
    IF NOT FOUND THEN RAISE EXCEPTION 'Collection not found: %', normalized_slug; END IF;
    result := jsonb_build_object('success', true, 'operation','rename', 'collection_slug', normalized_slug);
  ELSE
    DELETE FROM public.user_favorites WHERE user_id = p_user_id AND collection_slug = normalized_slug;
    DELETE FROM public.user_collections WHERE user_id = p_user_id AND slug = normalized_slug;
    result := jsonb_build_object('success', true, 'operation','delete', 'collection_slug', normalized_slug);
  END IF;

  RETURN result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'error_code', SQLSTATE);
END; $$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION public.manage_collection TO authenticated, anon;

-- Update get_user_collections to include wardrobe as a system collection
CREATE OR REPLACE FUNCTION public.get_user_collections(p_user_id UUID DEFAULT auth.uid())
RETURNS TABLE (
  collection_slug TEXT,
  collection_label TEXT,
  item_count BIGINT,
  is_system BOOLEAN,
  collection_created_at TIMESTAMPTZ
) AS $$
DECLARE
  reserved_slugs TEXT[] := ARRAY['favorites','generations','wardrobe'];
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT slug AS collection_slug, label AS collection_label, created_at
    FROM public.user_collections
    WHERE user_id = p_user_id

    UNION ALL

    SELECT 'favorites'::text AS collection_slug, 'Favorites'::text AS collection_label,
           min(uf.created_at) AS created_at
    FROM public.user_favorites uf
    WHERE uf.user_id = p_user_id AND lower(uf.collection_slug) = 'favorites'

    UNION ALL

    SELECT 'generations'::text AS collection_slug, 'Generations'::text AS collection_label,
           min(uf.created_at) AS created_at
    FROM public.user_favorites uf
    WHERE uf.user_id = p_user_id AND lower(uf.collection_slug) = 'generations'

    UNION ALL

    SELECT 'wardrobe'::text AS collection_slug, 'Wardrobe'::text AS collection_label,
           min(uf.created_at) AS created_at
    FROM public.user_favorites uf
    WHERE uf.user_id = p_user_id AND lower(uf.collection_slug) = 'wardrobe'
  )
  SELECT
    b.collection_slug,
    b.collection_label,
    COALESCE(COUNT(uf.id), 0) AS item_count,
    (b.collection_slug = ANY(reserved_slugs)) AS is_system,
    MIN(b.created_at) AS collection_created_at
  FROM base b
  LEFT JOIN public.user_favorites uf
    ON uf.user_id = p_user_id
   AND lower(uf.collection_slug) = lower(b.collection_slug)
  GROUP BY b.collection_slug, b.collection_label
  ORDER BY CASE WHEN b.collection_slug = ANY(reserved_slugs) THEN 0 ELSE 1 END,
           b.collection_label;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION public.get_user_collections TO authenticated, anon;

-- Update get_collections_with_previews to include wardrobe in system collections
DROP FUNCTION IF EXISTS public.get_collections_with_previews(uuid);
CREATE OR REPLACE FUNCTION public.get_collections_with_previews(p_user_id uuid DEFAULT auth.uid())
RETURNS TABLE (
  collection_slug text,
  collection_label text,
  item_count bigint,
  is_system boolean,
  preview_outfit_ids text[],
  preview_outfits_render jsonb,
  preview_items jsonb
) AS $$
WITH system_collections AS (
  SELECT 'wardrobe'::text AS collection_slug, 'Wardrobe'::text AS collection_label, true AS is_system
  UNION ALL
  SELECT 'try-ons'::text, 'Try-ons'::text, true
  UNION ALL
  SELECT 'favorites'::text, 'Favorites'::text, true
),
user_collections AS (
  SELECT uc.slug AS collection_slug, uc.label AS collection_label, false AS is_system
  FROM public.user_collections uc
  WHERE uc.user_id = p_user_id
),
all_collections AS (
  SELECT * FROM system_collections
  UNION ALL
  SELECT * FROM user_collections
)
SELECT
  c.collection_slug,
  c.collection_label,
  COALESCE(s.item_count, 0) AS item_count,
  c.is_system,
  COALESCE(s.preview_outfit_ids, '{}'::text[]) AS preview_outfit_ids,
  COALESCE(preview.preview_outfits_render, '[]'::jsonb) AS preview_outfits_render,
  COALESCE(s.preview_items, '[]'::jsonb) AS preview_items
FROM all_collections c
LEFT JOIN public.user_collection_stats s
  ON s.user_id = p_user_id AND s.collection_slug = public.canonical_collection_slug(c.collection_slug)
LEFT JOIN LATERAL (
  SELECT COALESCE(jsonb_agg(entry.outfit_entry ORDER BY entry.ord), '[]'::jsonb) AS preview_outfits_render
  FROM (
    SELECT
      ids.ord,
      jsonb_build_object(
        'outfitId', ids.outfit_id,
        'gender', o.gender,
        'renderedItems', COALESCE(items.rendered_items, '[]'::jsonb)
      ) AS outfit_entry
    FROM unnest(COALESCE(s.preview_outfit_ids, '{}'::text[])) WITH ordinality AS ids(outfit_id, ord)
    JOIN public.outfits o ON o.id::text = ids.outfit_id
    LEFT JOIN public.products p_top ON p_top.id = o.top_id
    LEFT JOIN public.products p_bottom ON p_bottom.id = o.bottom_id
    LEFT JOIN public.products p_shoes ON p_shoes.id = o.shoes_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(x.item ORDER BY x.z), '[]'::jsonb) AS rendered_items
      FROM (
        SELECT
          1 AS z,
          jsonb_build_object(
            'id', p_top.id::text,
            'zone', 'top',
            'imageUrl', p_top.image_url,
            'placementX', COALESCE(p_top.placement_x, 0),
            'placementY', COALESCE(p_top.placement_y, 0),
            'imageLengthCm', COALESCE(p_top.image_length, 0),
            'bodyPartsVisible', p_top.body_parts_visible
          ) AS item
        WHERE p_top.id IS NOT NULL AND p_top.image_url IS NOT NULL AND length(trim(p_top.image_url)) > 0

        UNION ALL

        SELECT
          2 AS z,
          jsonb_build_object(
            'id', p_bottom.id::text,
            'zone', 'bottom',
            'imageUrl', p_bottom.image_url,
            'placementX', COALESCE(p_bottom.placement_x, 0),
            'placementY', COALESCE(p_bottom.placement_y, 0),
            'imageLengthCm', COALESCE(p_bottom.image_length, 0),
            'bodyPartsVisible', p_bottom.body_parts_visible
          ) AS item
        WHERE p_bottom.id IS NOT NULL AND p_bottom.image_url IS NOT NULL AND length(trim(p_bottom.image_url)) > 0

        UNION ALL

        SELECT
          3 AS z,
          jsonb_build_object(
            'id', p_shoes.id::text,
            'zone', 'shoes',
            'imageUrl', p_shoes.image_url,
            'placementX', COALESCE(p_shoes.placement_x, 0),
            'placementY', COALESCE(p_shoes.placement_y, 0),
            'imageLengthCm', COALESCE(p_shoes.image_length, 0),
            'bodyPartsVisible', p_shoes.body_parts_visible
          ) AS item
        WHERE p_shoes.id IS NOT NULL AND p_shoes.image_url IS NOT NULL AND length(trim(p_shoes.image_url)) > 0
      ) x
    ) items ON true
  ) entry
) preview ON true;
$$ LANGUAGE sql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION public.get_collections_with_previews(uuid) TO authenticated, service_role, anon;
