-- Apply the draft rule inside the creations RPCs, before pagination.
--
-- The Studio creates a "draft-look-<ts>" outfit whenever it is opened from a
-- product, similar items, a shared look or an inspiration import, so it has a row
-- to work on. Those are scaffolding, not creations. Since cd516cf4 the SPA hid them
-- (unless the user's latest try-on of one is ready) — but it did so in
-- fetchCreations, AFTER get_user_creations_page had already cut the list into
-- pages of 6. Two things break as a result:
--
--   1. useInfiniteQuery stops when a page comes back shorter than the page size.
--      A page that contains even one draft is shorter after filtering, so the tab
--      silently truncates; a page that is all drafts filters to zero and the tab
--      shows "No creations yet" over a header that says 26.
--   2. get_user_creations_counts never applied the rule at all, so the header
--      counted every draft the list was hiding.
--
-- Moving the rule here means pages arrive full of real creations, the counter and
-- the list share one definition, and the SPA filter becomes a no-op to delete.
-- The rule is the SPA's exactly: a draft shows only if its LATEST generation is
-- ready, matching latest_generation_status === "ready". Note it tests the status
-- alone; latest_ready (which does require a stored image) supplies the returned
-- storage path but takes no part in the filter, so a 'ready' row with no file
-- still lists, exactly as the SPA filter did.

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
with latest_generation as (
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
user_outfit_ids as (
  select distinct o.id::text as outfit_id
  from public.outfits o
  left join latest_generation lg on lg.outfit_id = o.id::text
  where o.user_id = p_user_id
    and (
      o.name is null
      or o.name not like 'draft-look-%'
      or lg.status = 'ready'
    )
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
with latest_generation as (
  select distinct on (ug.outfit_id)
    ug.outfit_id::text as outfit_id,
    ug.status::text as status
  from public.user_generations ug
  where ug.user_id = p_user_id
    and ug.outfit_id is not null
  order by ug.outfit_id, ug.created_at desc
),
tryons as (
  select count(distinct ug.outfit_id) as count
  from public.user_generations ug
  where ug.user_id = p_user_id
    and ug.status = 'ready'
    and ug.outfit_id is not null
),
saved as (
  select count(*) as count
  from public.outfits o
  left join latest_generation lg on lg.outfit_id = o.id::text
  where o.user_id = p_user_id
    and (
      o.name is null
      or o.name not like 'draft-look-%'
      or lg.status = 'ready'
    )
)
select
  tryons.count as tryon_outfit_count,
  saved.count as saved_outfit_count,
  saved.count as total_count
from tryons, saved;
$$;
