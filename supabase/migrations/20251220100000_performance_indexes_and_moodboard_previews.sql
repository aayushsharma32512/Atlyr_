-- Performance improvements for collections/moodboards and creations

-- Composite indexes to speed up favorite lookups and creation queries
create index if not exists idx_user_favorites_user_collection_created_at
  on public.user_favorites (user_id, collection_slug, created_at desc);

create index if not exists idx_outfits_user_created_at
  on public.outfits (user_id, created_at desc);

create index if not exists idx_user_generations_outfit_created_at
  on public.user_generations (outfit_id, created_at desc);

-- RPC to fetch moodboard previews (top 3 outfits per collection slug)
-- normalize legacy try-ons slug to the canonical value
update public.user_favorites
set collection_slug = 'try-ons'
where collection_slug = 'generations';

create or replace function public.get_moodboard_previews(
  p_user_id uuid,
  p_slugs text[]
)
returns table (
  collection_slug text,
  outfit_id text,
  background_id text
)
language sql
stable
as $$
with normalized_slugs as (
  select distinct
    case
      when slug = 'generations' then 'try-ons'
      else slug
    end as collection_slug
  from unnest(p_slugs) as slug
), ranked as (
  select
    case
      when uf.collection_slug = 'generations' then 'try-ons'
      else uf.collection_slug
    end as collection_slug,
    uf.outfit_id,
    o.background_id,
    row_number() over (
      partition by
        case
          when uf.collection_slug = 'generations' then 'try-ons'
          else uf.collection_slug
        end
      order by uf.created_at desc
    ) as rn
  from public.user_favorites uf
  join normalized_slugs s
    on s.collection_slug = case
      when uf.collection_slug = 'generations' then 'try-ons'
      else uf.collection_slug
    end
  left join public.outfits o
    on o.id = uf.outfit_id
  where uf.user_id = p_user_id
)
select
  collection_slug,
  outfit_id,
  background_id
from ranked
where rn <= 3;
$$;

grant execute on function public.get_moodboard_previews(uuid, text[]) to authenticated, service_role, anon;
