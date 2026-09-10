-- The Creations tab lists only outfits the user owns. Try-ons keep their own home.
--
-- get_user_creations_page used to UNION "outfits I own" with "outfits I have a
-- try-on for". That made a try-on alone enough to keep an outfit in Creations, so
-- deleting a creation (anonymiseOutfit: user_id -> NULL) removed it from the first
-- half and it came straight back through the second — still listed, still counted,
-- with the delete having "worked". Try-ons already have their own surface: the
-- Home screen's Try-ons board reads user_generations directly (fetchTryOns) and
-- never goes through this function, so nothing is lost by taking them out here.
--
-- Owned outfits that were tried on are unchanged: latest_generation / latest_ready
-- are per-outfit joins, so the flip-to-try-on image still comes back for them.
--
-- get_user_creations_counts follows: total_count is the number of rows the page
-- function can return, so it is now the owned count. tryon_outfit_count stays in
-- the result shape for anything that still reads it.

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
  saved.count as total_count
from tryons, saved;
$$;
