-- Extend collections previews to include render payload for outfit cards,
-- and add an RPC to fetch creations with the latest generation per outfit.
--
-- Notes:
-- - We keep preview_outfit_ids for compatibility, but add preview_outfits_render JSON.
-- - Saved outfits are immutable; this payload is stable for a given outfit_id.

-- 1) Replace get_collections_with_previews with an extended return type
drop function if exists public.get_collections_with_previews(uuid);
create or replace function public.get_collections_with_previews(p_user_id uuid default auth.uid())
returns table (
  collection_slug text,
  collection_label text,
  item_count bigint,
  is_system boolean,
  preview_outfit_ids text[],
  preview_outfits_render jsonb
)
language sql
stable
security definer
set search_path = public
as $$
with system_collections as (
  select 'favorites'::text as collection_slug, 'Favorites'::text as collection_label, true as is_system
  union all
  select 'try-ons'::text, 'Try-ons'::text, true
),
user_collections as (
  select uc.slug as collection_slug, uc.label as collection_label, false as is_system
  from public.user_collections uc
  where uc.user_id = p_user_id
),
all_collections as (
  select * from system_collections
  union all
  select * from user_collections
)
select
  c.collection_slug,
  c.collection_label,
  coalesce(s.item_count, 0) as item_count,
  c.is_system,
  coalesce(s.preview_outfit_ids, '{}'::text[]) as preview_outfit_ids,
  coalesce(preview.preview_outfits_render, '[]'::jsonb) as preview_outfits_render
from all_collections c
left join public.user_collection_stats s
  on s.user_id = p_user_id and s.collection_slug = public.canonical_collection_slug(c.collection_slug)
left join lateral (
  select coalesce(jsonb_agg(entry.outfit_entry order by entry.ord), '[]'::jsonb) as preview_outfits_render
  from (
    select
      ids.ord,
      jsonb_build_object(
        'outfitId', ids.outfit_id,
        'gender', o.gender,
        'renderedItems', coalesce(items.rendered_items, '[]'::jsonb)
      ) as outfit_entry
    from unnest(coalesce(s.preview_outfit_ids, '{}'::text[])) with ordinality as ids(outfit_id, ord)
    join public.outfits o on o.id::text = ids.outfit_id
    left join public.products p_top on p_top.id = o.top_id
    left join public.products p_bottom on p_bottom.id = o.bottom_id
    left join public.products p_shoes on p_shoes.id = o.shoes_id
    left join lateral (
      select coalesce(jsonb_agg(x.item order by x.z), '[]'::jsonb) as rendered_items
      from (
        select
          1 as z,
          jsonb_build_object(
            'id', p_top.id::text,
            'zone', 'top',
            'imageUrl', p_top.image_url,
            'placementX', coalesce(p_top.placement_x, 0),
            'placementY', coalesce(p_top.placement_y, 0),
            'imageLengthCm', coalesce(p_top.image_length, 0),
            'bodyPartsVisible', p_top.body_parts_visible
          ) as item
        where p_top.id is not null and p_top.image_url is not null and length(trim(p_top.image_url)) > 0

        union all

        select
          2 as z,
          jsonb_build_object(
            'id', p_bottom.id::text,
            'zone', 'bottom',
            'imageUrl', p_bottom.image_url,
            'placementX', coalesce(p_bottom.placement_x, 0),
            'placementY', coalesce(p_bottom.placement_y, 0),
            'imageLengthCm', coalesce(p_bottom.image_length, 0),
            'bodyPartsVisible', p_bottom.body_parts_visible
          ) as item
        where p_bottom.id is not null and p_bottom.image_url is not null and length(trim(p_bottom.image_url)) > 0

        union all

        select
          3 as z,
          jsonb_build_object(
            'id', p_shoes.id::text,
            'zone', 'shoes',
            'imageUrl', p_shoes.image_url,
            'placementX', coalesce(p_shoes.placement_x, 0),
            'placementY', coalesce(p_shoes.placement_y, 0),
            'imageLengthCm', coalesce(p_shoes.image_length, 0),
            'bodyPartsVisible', p_shoes.body_parts_visible
          ) as item
        where p_shoes.id is not null and p_shoes.image_url is not null and length(trim(p_shoes.image_url)) > 0
      ) x
    ) items on true
  ) entry
) preview on true
order by case when c.is_system then 0 else 1 end, c.collection_label;
$$;

grant execute on function public.get_collections_with_previews(uuid) to authenticated, service_role, anon;

-- 2) RPC for creations page: return outfits + latest generation storage_path (per outfit)
drop function if exists public.get_user_creations_page(uuid, int, int);
create or replace function public.get_user_creations_page(
  p_user_id uuid,
  p_page int default 0,
  p_size int default 20
)
returns table (
  outfit_id text,
  outfit_name text,
  created_at timestamptz,
  background_id text,
  gender text,
  latest_generation_storage_path text
)
language sql
stable
security definer
set search_path = public
as $$
with page_outfits as (
  select
    o.id::text as outfit_id,
    o.name as outfit_name,
    o.created_at,
    o.background_id::text as background_id,
    o.gender
  from public.outfits o
  where o.user_id = p_user_id
  order by o.created_at desc
  limit p_size
  offset greatest(0, p_page) * greatest(0, p_size)
)
select
  po.outfit_id,
  po.outfit_name,
  po.created_at,
  po.background_id,
  po.gender,
  lg.storage_path as latest_generation_storage_path
from page_outfits po
left join lateral (
  select ug.storage_path
  from public.user_generations ug
  where ug.user_id = p_user_id and ug.outfit_id::text = po.outfit_id
  order by ug.created_at desc
  limit 1
) lg on true
order by po.created_at desc;
$$;

grant execute on function public.get_user_creations_page(uuid, int, int) to authenticated, service_role, anon;
