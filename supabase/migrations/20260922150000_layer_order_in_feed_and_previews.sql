-- Stage 4 of outfit layering. Three things, all read-side:
-- 1. Feed functions prefer a row with no stored stacking when the same three pieces appear twice,
--    so the feed shows the default rule and personal orders stay personal.
-- 2. Board previews and board items carry the row's stacking, so cards draw it.
-- 3. Existing preview JSON is rebuilt once so current boards pick it up.

-- get_curated_outfit_ids_seeded: prefer null layer_order inside the per-combo dedupe.
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
      AND o.source_outfit_id = o.id
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
      -- The default stacking wins over a personal one for the same pieces.
      (o.layer_order IS NULL) DESC,
      o.rating DESC NULLS LAST,
      o.created_at DESC
  ) deduped
  ORDER BY md5(deduped.id::text || coalesce(p_seed, '')) ASC, deduped.id ASC
  LIMIT COALESCE(p_limit, 50)
  OFFSET GREATEST(p_offset, 0);
$$;

-- get_all_outfit_ids: prefer null layer_order inside the per-combo dedupe.
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
      AND o.source_outfit_id = o.id
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
      -- The default stacking wins over a personal one for the same pieces.
      (o.layer_order IS NULL) DESC,
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

-- refresh_user_collection_stats: outfit preview entries carry layerOrder (2 sites).
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
          'layerOrder', o.layer_order,
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
            'layerOrder', o.layer_order,
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

-- get_moodboard_previews: one more output column, so the function is recreated.
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
  layer_order jsonb,
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
    item->'layerOrder' AS layer_order,
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

-- get_collections_with_previews: outfit preview entries carry layerOrder.
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
        'layerOrder', o.layer_order,
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

-- get_moodboard_items_batch: the outfit object carries layer_order, read by the same mapper as Studio.
create or replace function public.get_moodboard_items_batch(
  p_user_id uuid default auth.uid(),
  p_slugs text[] default '{}'::text[],
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  collection_slug text,
  created_at timestamptz,
  item_type text,
  outfit jsonb,
  product jsonb
)
language sql
stable
security definer
as $$
with normalized_slugs as (
  select distinct public.canonical_collection_slug(slug) as collection_slug
  from unnest(p_slugs) as slug
  where slug is not null and trim(slug) <> ''
),
ranked as (
  select
    public.canonical_collection_slug(uf.collection_slug) as collection_slug,
    uf.created_at,
    uf.outfit_id,
    uf.product_id,
    row_number() over (partition by public.canonical_collection_slug(uf.collection_slug) order by uf.created_at desc) as rn
  from public.user_favorites uf
  join normalized_slugs ns
    on ns.collection_slug = public.canonical_collection_slug(uf.collection_slug)
  where uf.user_id = p_user_id
),
filtered as (
  select *
  from ranked
  where rn > p_offset and rn <= p_offset + p_limit
)
select
  f.collection_slug,
  f.created_at,
  case when f.outfit_id is not null then 'outfit' else 'product' end as item_type,
  case
    when f.outfit_id is null then null
    else jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'category', o.category,
      'gender', o.gender,
      'background_id', o.background_id,
      'fit', o.fit,
      'feel', o.feel,
      'vibes', o.vibes,
      'word_association', o.word_association,
      'rating', o.rating,
      'popularity', o.popularity,
      'created_at', o.created_at,
      'layer_order', o.layer_order,
      'created_by', o.created_by,
      'user_id', o.user_id,
      'occasion', case
        when oc.id is null then null
        else jsonb_build_object(
          'id', oc.id,
          'name', oc.name,
          'slug', oc.slug,
          'background_url', oc.background_url,
          'description', oc.description
        )
      end,
      'top', case
        when top.id is null then null
        else jsonb_build_object(
          'id', top.id,
          'type', top.type,
          'brand', top.brand,
          'gender', top.gender,
          'product_name', top.product_name,
          'size', top.size,
          'price', top.price,
          'currency', top.currency,
          'image_url', top.image_url,
          'product_url', top.product_url,
          'description', top.description,
          'color', top.color,
          'color_group', top.color_group,
          'category_id', top.category_id,
          'fit', top.fit,
          'feel', top.feel,
          'placement_x', top.placement_x,
          'placement_y', top.placement_y,
          'image_length', top.image_length,
          'type_category', top.type_category,
          'body_parts_visible', top.body_parts_visible
        )
      end,
      'bottom', case
        when bottom.id is null then null
        else jsonb_build_object(
          'id', bottom.id,
          'type', bottom.type,
          'brand', bottom.brand,
          'gender', bottom.gender,
          'product_name', bottom.product_name,
          'size', bottom.size,
          'price', bottom.price,
          'currency', bottom.currency,
          'image_url', bottom.image_url,
          'product_url', bottom.product_url,
          'description', bottom.description,
          'color', bottom.color,
          'color_group', bottom.color_group,
          'category_id', bottom.category_id,
          'fit', bottom.fit,
          'feel', bottom.feel,
          'placement_x', bottom.placement_x,
          'placement_y', bottom.placement_y,
          'image_length', bottom.image_length,
          'type_category', bottom.type_category,
          'body_parts_visible', bottom.body_parts_visible
        )
      end,
      'shoes', case
        when shoes.id is null then null
        else jsonb_build_object(
          'id', shoes.id,
          'type', shoes.type,
          'brand', shoes.brand,
          'gender', shoes.gender,
          'product_name', shoes.product_name,
          'size', shoes.size,
          'price', shoes.price,
          'currency', shoes.currency,
          'image_url', shoes.image_url,
          'product_url', shoes.product_url,
          'description', shoes.description,
          'color', shoes.color,
          'color_group', shoes.color_group,
          'category_id', shoes.category_id,
          'fit', shoes.fit,
          'feel', shoes.feel,
          'placement_x', shoes.placement_x,
          'placement_y', shoes.placement_y,
          'image_length', shoes.image_length,
          'type_category', shoes.type_category,
          'body_parts_visible', shoes.body_parts_visible
        )
      end
    )
  end as outfit,
  case
    when f.product_id is null then null
    else jsonb_build_object(
      'id', p.id,
      'image_url', p.image_url,
      'brand', p.brand,
      'price', p.price,
      'currency', p.currency,
      'product_name', p.product_name
    )
  end as product
from filtered f
left join public.outfits o on o.id = f.outfit_id
left join public.occasions oc on oc.id = o.occasion
left join public.products top on top.id = o.top_id
left join public.products bottom on bottom.id = o.bottom_id
left join public.products shoes on shoes.id = o.shoes_id
left join public.products p on p.id = f.product_id
order by f.collection_slug, f.created_at desc;
$$;

-- Rebuild every stored preview once, so current boards carry the stacking without waiting for a save.
SELECT public.refresh_user_collection_stats(s.user_id, s.collection_slug)
FROM public.user_collection_stats s;
