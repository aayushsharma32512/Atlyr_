-- Batch moodboard items by collection slug
drop function if exists public.get_moodboard_items_batch(uuid, text[], integer, integer);
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

grant execute on function public.get_moodboard_items_batch(uuid, text[], integer, integer) to authenticated, service_role, anon;
