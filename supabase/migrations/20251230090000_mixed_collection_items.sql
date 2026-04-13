-- Mixed collections: allow products in user_favorites and store mixed previews

-- 1) Extend user_favorites to support products
ALTER TABLE public.user_favorites
  ADD COLUMN IF NOT EXISTS product_id TEXT REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE public.user_favorites
  ALTER COLUMN outfit_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_favorites_one_item'
  ) THEN
    ALTER TABLE public.user_favorites
      ADD CONSTRAINT user_favorites_one_item
      CHECK (
        (outfit_id IS NOT NULL AND product_id IS NULL)
        OR (outfit_id IS NULL AND product_id IS NOT NULL)
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_favorites_user_collection_product
  ON public.user_favorites (user_id, collection_slug, product_id)
  WHERE product_id IS NOT NULL;

-- 2) Extend stats table for mixed previews
ALTER TABLE public.user_collection_stats
  ADD COLUMN IF NOT EXISTS preview_items JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 3) Refresh function: count mixed items + store mixed previews
CREATE OR REPLACE FUNCTION public.refresh_user_collection_stats(
  p_user_id uuid,
  p_collection_slug text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_slug text;
  v_count bigint;
  v_preview_outfit_ids text[];
  v_preview_items jsonb;
BEGIN
  normalized_slug := public.canonical_collection_slug(p_collection_slug);
  IF normalized_slug IS NULL OR p_user_id IS NULL THEN
    RETURN;
  END IF;

  IF normalized_slug = 'try-ons' THEN
    SELECT COUNT(*)
      INTO v_count
    FROM public.user_favorites uf
    WHERE uf.user_id = p_user_id
      AND lower(uf.collection_slug) IN ('try-ons', 'generations')
      AND uf.outfit_id IS NOT NULL;

    SELECT COALESCE(ARRAY(
      SELECT uf.outfit_id
      FROM public.user_favorites uf
      WHERE uf.user_id = p_user_id
        AND lower(uf.collection_slug) IN ('try-ons', 'generations')
        AND uf.outfit_id IS NOT NULL
      ORDER BY uf.created_at DESC
      LIMIT 3
    ), '{}'::text[])
      INTO v_preview_outfit_ids;

    SELECT COALESCE(jsonb_agg(entry.item ORDER BY entry.created_at DESC), '[]'::jsonb)
      INTO v_preview_items
    FROM (
      SELECT
        uf.created_at,
        jsonb_build_object(
          'itemType', 'outfit',
          'itemId', uf.outfit_id,
          'gender', o.gender,
          'renderedItems', COALESCE(items.rendered_items, '[]'::jsonb)
        ) AS item
      FROM public.user_favorites uf
      JOIN public.outfits o ON o.id::text = uf.outfit_id
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
          WHERE p_top.id IS NOT NULL
            AND p_top.image_url IS NOT NULL
            AND length(trim(p_top.image_url)) > 0

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
          WHERE p_bottom.id IS NOT NULL
            AND p_bottom.image_url IS NOT NULL
            AND length(trim(p_bottom.image_url)) > 0

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
          WHERE p_shoes.id IS NOT NULL
            AND p_shoes.image_url IS NOT NULL
            AND length(trim(p_shoes.image_url)) > 0
        ) x
      ) items ON true
      WHERE uf.user_id = p_user_id
        AND lower(uf.collection_slug) IN ('try-ons', 'generations')
        AND uf.outfit_id IS NOT NULL
      ORDER BY uf.created_at DESC
      LIMIT 3
    ) entry;
  ELSE
    SELECT COUNT(*)
      INTO v_count
    FROM public.user_favorites uf
    WHERE uf.user_id = p_user_id
      AND lower(uf.collection_slug) = normalized_slug
      AND (uf.outfit_id IS NOT NULL OR uf.product_id IS NOT NULL);

    SELECT COALESCE(ARRAY(
      SELECT uf.outfit_id
      FROM public.user_favorites uf
      WHERE uf.user_id = p_user_id
        AND lower(uf.collection_slug) = normalized_slug
        AND uf.outfit_id IS NOT NULL
      ORDER BY uf.created_at DESC
      LIMIT 3
    ), '{}'::text[])
      INTO v_preview_outfit_ids;

    SELECT COALESCE(jsonb_agg(entry.item ORDER BY entry.created_at DESC), '[]'::jsonb)
      INTO v_preview_items
    FROM (
      SELECT *
      FROM (
        SELECT
          uf.created_at,
          jsonb_build_object(
            'itemType', 'outfit',
            'itemId', uf.outfit_id,
            'gender', o.gender,
            'renderedItems', COALESCE(items.rendered_items, '[]'::jsonb)
          ) AS item
        FROM public.user_favorites uf
        JOIN public.outfits o ON o.id::text = uf.outfit_id
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
            WHERE p_top.id IS NOT NULL
              AND p_top.image_url IS NOT NULL
              AND length(trim(p_top.image_url)) > 0

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
            WHERE p_bottom.id IS NOT NULL
              AND p_bottom.image_url IS NOT NULL
              AND length(trim(p_bottom.image_url)) > 0

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
            WHERE p_shoes.id IS NOT NULL
              AND p_shoes.image_url IS NOT NULL
              AND length(trim(p_shoes.image_url)) > 0
          ) x
        ) items ON true
        WHERE uf.user_id = p_user_id
          AND lower(uf.collection_slug) = normalized_slug
          AND uf.outfit_id IS NOT NULL

        UNION ALL

        SELECT
          uf.created_at,
          jsonb_build_object(
            'itemType', 'product',
            'itemId', uf.product_id,
            'imageUrl', p.image_url,
            'brand', p.brand,
            'price', p.price,
            'currency', p.currency,
            'productName', p.product_name
          ) AS item
        FROM public.user_favorites uf
        JOIN public.products p ON p.id = uf.product_id
        WHERE uf.user_id = p_user_id
          AND lower(uf.collection_slug) = normalized_slug
          AND uf.product_id IS NOT NULL
      ) mixed
      ORDER BY created_at DESC
      LIMIT 3
    ) entry;
  END IF;

  INSERT INTO public.user_collection_stats (
    user_id,
    collection_slug,
    item_count,
    preview_outfit_ids,
    preview_items,
    updated_at
  )
  VALUES (
    p_user_id,
    normalized_slug,
    COALESCE(v_count, 0),
    COALESCE(v_preview_outfit_ids, '{}'::text[]),
    COALESCE(v_preview_items, '[]'::jsonb),
    now()
  )
  ON CONFLICT (user_id, collection_slug)
  DO UPDATE SET
    item_count = excluded.item_count,
    preview_outfit_ids = excluded.preview_outfit_ids,
    preview_items = excluded.preview_items,
    updated_at = excluded.updated_at;
END;
$$;

-- 4) Update get_user_collections to count mixed items
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

-- 5) Update get_moodboard_previews to return mixed preview items
DROP FUNCTION IF EXISTS public.get_moodboard_previews(uuid, text[]);
CREATE OR REPLACE FUNCTION public.get_moodboard_previews(
  p_user_id uuid,
  p_slugs text[]
)
RETURNS TABLE (
  collection_slug text,
  item_type text,
  item_id text,
  image_url text,
  gender text,
  rendered_items jsonb,
  brand text,
  price integer,
  currency text,
  product_name text
) AS $$
  SELECT
    j.collection_slug,
    (item->>'itemType')::text AS item_type,
    (item->>'itemId')::text AS item_id,
    (item->>'imageUrl')::text AS image_url,
    (item->>'gender')::text AS gender,
    COALESCE(item->'renderedItems', '[]'::jsonb) AS rendered_items,
    (item->>'brand')::text AS brand,
    (item->>'price')::integer AS price,
    (item->>'currency')::text AS currency,
    (item->>'productName')::text AS product_name
  FROM (
    SELECT DISTINCT public.canonical_collection_slug(slug) AS collection_slug
    FROM unnest(p_slugs) AS slug
    WHERE slug IS NOT NULL AND length(trim(slug)) > 0
  ) j
  LEFT JOIN public.user_collection_stats s
    ON s.user_id = p_user_id AND s.collection_slug = j.collection_slug
  LEFT JOIN LATERAL jsonb_array_elements(COALESCE(s.preview_items, '[]'::jsonb)) AS item ON true
  ORDER BY j.collection_slug;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.get_moodboard_previews(uuid, text[]) TO authenticated, service_role, anon;

-- 6) Update get_collections_with_previews to include mixed previews
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
  SELECT 'favorites'::text AS collection_slug, 'Favorites'::text AS collection_label, true AS is_system
  UNION ALL
  SELECT 'try-ons'::text, 'Try-ons'::text, true
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
) preview ON true
ORDER BY CASE WHEN c.is_system THEN 0 ELSE 1 END, c.collection_label;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.get_collections_with_previews(uuid) TO authenticated, service_role, anon;

-- 7) Backfill mixed previews for existing stats
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT DISTINCT user_id, public.canonical_collection_slug(collection_slug) AS slug
    FROM public.user_favorites
    WHERE user_id IS NOT NULL AND collection_slug IS NOT NULL
  LOOP
    PERFORM public.refresh_user_collection_stats(rec.user_id, rec.slug);
  END LOOP;
END $$;
