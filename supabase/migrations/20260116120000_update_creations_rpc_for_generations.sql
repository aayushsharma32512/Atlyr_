-- Update creations RPC to include user generations + owned outfits, ordered by latest activity.

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
  is_private boolean,
  visible_in_feed boolean,
  latest_generation_storage_path text,
  latest_generation_status text,
  latest_generation_created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
with user_outfit_ids as (
  select distinct o.id::text as outfit_id
  from public.outfits o
  where o.user_id = p_user_id
  union
  select distinct ug.outfit_id::text as outfit_id
  from public.user_generations ug
  where ug.user_id = p_user_id
    and ug.outfit_id is not null
),
latest_generation as (
  select distinct on (ug.outfit_id)
    ug.outfit_id::text as outfit_id,
    ug.status::text as status,
    ug.created_at as created_at
  from public.user_generations ug
  where ug.user_id = p_user_id
    and ug.outfit_id is not null
  order by ug.outfit_id, ug.created_at desc
),
latest_ready as (
  select distinct on (ug.outfit_id)
    ug.outfit_id::text as outfit_id,
    ug.storage_path as storage_path
  from public.user_generations ug
  where ug.user_id = p_user_id
    and ug.outfit_id is not null
    and ug.status = 'ready'
    and ug.storage_path is not null
    and length(trim(ug.storage_path)) > 0
  order by ug.outfit_id, ug.created_at desc
),
joined as (
  select
    uo.outfit_id,
    o.name as outfit_name,
    o.created_at as outfit_created_at,
    o.background_id::text as background_id,
    o.gender,
    o.is_private,
    o.visible_in_feed,
    lg.created_at as latest_generation_created_at,
    lg.status as latest_generation_status,
    lr.storage_path as latest_generation_storage_path
  from user_outfit_ids uo
  left join public.outfits o on o.id::text = uo.outfit_id
  left join latest_generation lg on lg.outfit_id = uo.outfit_id
  left join latest_ready lr on lr.outfit_id = uo.outfit_id
),
ordered as (
  select
    *,
    coalesce(latest_generation_created_at, outfit_created_at) as sort_created_at
  from joined
)
select
  outfit_id,
  outfit_name,
  coalesce(latest_generation_created_at, outfit_created_at) as created_at,
  background_id,
  gender,
  is_private,
  visible_in_feed,
  latest_generation_storage_path,
  latest_generation_status,
  latest_generation_created_at
from ordered
order by sort_created_at desc
limit p_size
offset greatest(0, p_page) * greatest(0, p_size);
$$;

grant execute on function public.get_user_creations_page(uuid, int, int) to authenticated, service_role, anon;
