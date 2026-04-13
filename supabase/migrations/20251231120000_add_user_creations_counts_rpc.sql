-- RPC to fetch creations counts: ready-only try-ons (distinct outfits) + saved outfits.
-- Used by Collections header for the "creations" count.

drop function if exists public.get_user_creations_counts(uuid);
create or replace function public.get_user_creations_counts(p_user_id uuid)
returns table (
  tryon_outfit_count bigint,
  saved_outfit_count bigint,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
with tryons as (
  select count(distinct ug.outfit_id) as count
  from public.user_generations ug
  where ug.user_id = p_user_id
    and ug.status = 'ready'
    and ug.outfit_id is not null
),
saved as (
  select count(*) as count
  from public.outfits o
  where o.user_id = p_user_id
)
select
  tryons.count as tryon_outfit_count,
  saved.count as saved_outfit_count,
  tryons.count + saved.count as total_count
from tryons, saved;
$$;

grant execute on function public.get_user_creations_counts(uuid) to authenticated, service_role, anon;
