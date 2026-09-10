-- Stop the creations RPCs reading data the caller is not entitled to.
--
-- Both functions are SECURITY DEFINER, take the user id as a parameter, and are
-- granted to anon. SECURITY DEFINER runs as the owner and so bypasses RLS on the
-- tables underneath, which means anyone holding the publicly shipped anon key could
-- pass somebody else's uuid and read their outfit names, their creation counts and
-- the storage paths of their try-ons. Verified against production before this fix:
-- an anonymous caller got 3 outfit names and saved_outfit_count 483 for another
-- user, while `select from user_generations` for the same user correctly returned
-- nothing. The images themselves were never exposed — the `generations` bucket is
-- private and storage RLS is enforced independently — so this was metadata
-- disclosure rather than image access.
--
-- Pre-existing: both functions have had this shape since 20251231120000 and
-- 20260116120000. Fixed here rather than left alone because it is a one-line
-- predicate and the surrounding functions were already being rewritten.
--
-- The predicate is `p_user_id = auth.uid()`, with a carve-out for service_role
-- (auth.uid() is null there, so it needs the explicit branch). Measured on this
-- project: anon -> uid null / role 'anon'; authenticated -> uid set / role
-- 'authenticated'; service_role -> uid null / role 'service_role'. An anon caller
-- therefore evaluates `p_user_id = null`, which is NULL rather than true, and is
-- refused. It is applied at every base-table read, not just the outer select, so an
-- unauthorised caller reads nothing at all rather than reading and discarding.
--
-- No caller changes: the SPA passes the signed-in user's own id
-- (fetchCreations / fetchCreationsCounts, gated on `enabled: Boolean(user?.id)`),
-- and nothing outside the SPA calls either function.

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
with caller as (
  select (p_user_id = auth.uid() or auth.role() = 'service_role') as allowed
),
latest_generation as (
  select distinct on (ug.outfit_id)
    ug.outfit_id::text as outfit_id,
    ug.status::text as status,
    ug.created_at as created_at
  from public.user_generations ug, caller
  where caller.allowed
    and ug.user_id = p_user_id
    and ug.outfit_id is not null
  order by ug.outfit_id, ug.created_at desc
),
latest_ready as (
  select distinct on (ug.outfit_id)
    ug.outfit_id::text as outfit_id,
    ug.storage_path as storage_path
  from public.user_generations ug, caller
  where caller.allowed
    and ug.user_id = p_user_id
    and ug.outfit_id is not null
    and ug.status = 'ready'
    and ug.storage_path is not null
    and length(trim(ug.storage_path)) > 0
  order by ug.outfit_id, ug.created_at desc
),
user_outfit_ids as (
  select distinct o.id::text as outfit_id
  from public.outfits o
  cross join caller
  left join latest_generation lg on lg.outfit_id = o.id::text
  where caller.allowed
    and o.user_id = p_user_id
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
with caller as (
  select (p_user_id = auth.uid() or auth.role() = 'service_role') as allowed
),
latest_generation as (
  select distinct on (ug.outfit_id)
    ug.outfit_id::text as outfit_id,
    ug.status::text as status
  from public.user_generations ug, caller
  where caller.allowed
    and ug.user_id = p_user_id
    and ug.outfit_id is not null
  order by ug.outfit_id, ug.created_at desc
),
tryons as (
  select count(distinct ug.outfit_id) as count
  from public.user_generations ug, caller
  where caller.allowed
    and ug.user_id = p_user_id
    and ug.status = 'ready'
    and ug.outfit_id is not null
),
saved as (
  select count(*) as count
  from public.outfits o
  cross join caller
  left join latest_generation lg on lg.outfit_id = o.id::text
  where caller.allowed
    and o.user_id = p_user_id
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

grant execute on function public.get_user_creations_counts(uuid) to authenticated, service_role, anon;
