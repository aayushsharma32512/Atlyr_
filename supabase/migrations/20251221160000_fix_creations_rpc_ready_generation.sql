-- Fix creations RPC to prefer the latest ready generation per outfit.
-- Also return latest generation status metadata for UI/state handling.

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
  latest_generation_storage_path text,
  latest_generation_status text,
  latest_generation_created_at timestamptz
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
  lr.storage_path as latest_generation_storage_path,
  la.status as latest_generation_status,
  la.created_at as latest_generation_created_at
from page_outfits po
left join lateral (
  select ug.storage_path
  from public.user_generations ug
  where ug.user_id = p_user_id
    and ug.outfit_id::text = po.outfit_id
    and ug.status = 'ready'
    and ug.storage_path is not null
    and length(trim(ug.storage_path)) > 0
  order by ug.created_at desc
  limit 1
) lr on true
left join lateral (
  select ug.status::text as status, ug.created_at
  from public.user_generations ug
  where ug.user_id = p_user_id
    and ug.outfit_id::text = po.outfit_id
  order by ug.created_at desc
  limit 1
) la on true
order by po.created_at desc;
$$;

grant execute on function public.get_user_creations_page(uuid, int, int) to authenticated, service_role, anon;
