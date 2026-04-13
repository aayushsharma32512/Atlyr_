-- Precomputed collection stats + previews (system + user moodboards)
-- Goals:
-- - Maintain item_count + latest 3 outfit_ids per (user_id, collection_slug)
-- - Canonicalize slugs at read/write time only (do not rewrite user_favorites)
--   - 'generations' -> 'try-ons'
-- - Provide a single-read RPC for collections + previews
-- - Remove background_id from moodboard preview RPC payloads

-- 1) Canonical slug helper (read/write-time only)
create or replace function public.canonical_collection_slug(p_slug text)
returns text
language sql
immutable
as $$
  select case
    when p_slug is null then null
    when lower(trim(p_slug)) = 'generations' then 'try-ons'
    else lower(trim(p_slug))
  end
$$;

-- 2) Stats table (derived data)
create table if not exists public.user_collection_stats (
  user_id uuid not null references auth.users(id) on delete cascade,
  collection_slug text not null,
  item_count bigint not null default 0,
  preview_outfit_ids text[] not null default '{}'::text[],
  updated_at timestamptz not null default now(),
  primary key (user_id, collection_slug)
);

create index if not exists idx_user_collection_stats_user_id
  on public.user_collection_stats (user_id);

-- 3) Refresh function for a single (user, canonical_slug)
create or replace function public.refresh_user_collection_stats(
  p_user_id uuid,
  p_collection_slug text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_slug text;
  v_count bigint;
  v_preview text[];
begin
  normalized_slug := public.canonical_collection_slug(p_collection_slug);
  if normalized_slug is null or p_user_id is null then
    return;
  end if;

  if normalized_slug = 'try-ons' then
    select count(*) into v_count
    from public.user_favorites uf
    where uf.user_id = p_user_id
      and lower(uf.collection_slug) in ('try-ons', 'generations');

    select coalesce(array(
      select uf.outfit_id
      from public.user_favorites uf
      where uf.user_id = p_user_id
        and lower(uf.collection_slug) in ('try-ons', 'generations')
      order by uf.created_at desc
      limit 3
    ), '{}'::text[]) into v_preview;
  else
    select count(*) into v_count
    from public.user_favorites uf
    where uf.user_id = p_user_id
      and lower(uf.collection_slug) = normalized_slug;

    select coalesce(array(
      select uf.outfit_id
      from public.user_favorites uf
      where uf.user_id = p_user_id
        and lower(uf.collection_slug) = normalized_slug
      order by uf.created_at desc
      limit 3
    ), '{}'::text[]) into v_preview;
  end if;

  insert into public.user_collection_stats (user_id, collection_slug, item_count, preview_outfit_ids, updated_at)
  values (p_user_id, normalized_slug, coalesce(v_count, 0), v_preview, now())
  on conflict (user_id, collection_slug)
  do update set
    item_count = excluded.item_count,
    preview_outfit_ids = excluded.preview_outfit_ids,
    updated_at = excluded.updated_at;
end;
$$;

-- 4) Statement-level triggers using transition tables (bulk-friendly)
create or replace function public.refresh_user_collection_stats_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  for rec in
    select distinct user_id, public.canonical_collection_slug(collection_slug) as slug
    from new_rows
    where user_id is not null and collection_slug is not null
  loop
    perform public.refresh_user_collection_stats(rec.user_id, rec.slug);
  end loop;

  return null;
end;
$$;

create or replace function public.refresh_user_collection_stats_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  for rec in
    select distinct user_id, public.canonical_collection_slug(collection_slug) as slug
    from old_rows
    where user_id is not null and collection_slug is not null
  loop
    perform public.refresh_user_collection_stats(rec.user_id, rec.slug);
  end loop;

  return null;
end;
$$;

create or replace function public.refresh_user_collection_stats_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  for rec in
    select distinct user_id, public.canonical_collection_slug(collection_slug) as slug
    from (
      select user_id, collection_slug from new_rows
      union all
      select user_id, collection_slug from old_rows
    ) merged
    where user_id is not null and collection_slug is not null
  loop
    perform public.refresh_user_collection_stats(rec.user_id, rec.slug);
  end loop;

  return null;
end;
$$;

drop trigger if exists trg_refresh_user_collection_stats_insert on public.user_favorites;
create trigger trg_refresh_user_collection_stats_insert
  after insert on public.user_favorites
  referencing new table as new_rows
  for each statement
  execute function public.refresh_user_collection_stats_after_insert();

drop trigger if exists trg_refresh_user_collection_stats_delete on public.user_favorites;
create trigger trg_refresh_user_collection_stats_delete
  after delete on public.user_favorites
  referencing old table as old_rows
  for each statement
  execute function public.refresh_user_collection_stats_after_delete();

drop trigger if exists trg_refresh_user_collection_stats_update on public.user_favorites;
create trigger trg_refresh_user_collection_stats_update
  after update on public.user_favorites
  referencing old table as old_rows new table as new_rows
  for each statement
  execute function public.refresh_user_collection_stats_after_update();

-- 5) Backfill stats for existing data
with normalized as (
  select
    uf.user_id,
    public.canonical_collection_slug(uf.collection_slug) as collection_slug,
    uf.outfit_id,
    uf.created_at
  from public.user_favorites uf
  where uf.user_id is not null and uf.collection_slug is not null and uf.outfit_id is not null
),
ranked as (
  select
    user_id,
    collection_slug,
    outfit_id,
    created_at,
    row_number() over (partition by user_id, collection_slug order by created_at desc) as rn
  from normalized
),
agg as (
  select
    user_id,
    collection_slug,
    count(*) as item_count,
    coalesce(
      array_agg(outfit_id order by created_at desc) filter (where rn <= 3),
      '{}'::text[]
    ) as preview_outfit_ids
  from ranked
  group by user_id, collection_slug
)
insert into public.user_collection_stats (user_id, collection_slug, item_count, preview_outfit_ids, updated_at)
select user_id, collection_slug, item_count, preview_outfit_ids, now()
from agg
on conflict (user_id, collection_slug)
do update set
  item_count = excluded.item_count,
  preview_outfit_ids = excluded.preview_outfit_ids,
  updated_at = excluded.updated_at;

-- 6) Update moodboard previews RPC to use stats (no background_id)
-- Need to DROP first because CREATE OR REPLACE cannot change OUT-parameter return types.
drop function if exists public.get_moodboard_previews(uuid, text[]);
create or replace function public.get_moodboard_previews(
  p_user_id uuid,
  p_slugs text[]
)
returns table (
  collection_slug text,
  outfit_id text
)
language sql
stable
as $$
with normalized_slugs as (
  select distinct public.canonical_collection_slug(slug) as collection_slug
  from unnest(p_slugs) as slug
  where slug is not null and trim(slug) <> ''
),
joined as (
  select
    s.collection_slug,
    ucs.preview_outfit_ids
  from normalized_slugs s
  left join public.user_collection_stats ucs
    on ucs.user_id = p_user_id and ucs.collection_slug = s.collection_slug
)
select
  j.collection_slug,
  entry.outfit_id
from joined j
cross join lateral unnest(coalesce(j.preview_outfit_ids, '{}'::text[])) with ordinality as entry(outfit_id, ord)
order by j.collection_slug, entry.ord;
$$;

grant execute on function public.get_moodboard_previews(uuid, text[]) to authenticated, service_role, anon;

-- 7) Single-read RPC for collections + previews (system + user)
create or replace function public.get_collections_with_previews(p_user_id uuid default auth.uid())
returns table (
  collection_slug text,
  collection_label text,
  item_count bigint,
  is_system boolean,
  preview_outfit_ids text[]
)
language sql
stable
security definer
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
  coalesce(s.preview_outfit_ids, '{}'::text[]) as preview_outfit_ids
from all_collections c
left join public.user_collection_stats s
  on s.user_id = p_user_id and s.collection_slug = public.canonical_collection_slug(c.collection_slug)
order by case when c.is_system then 0 else 1 end, c.collection_label;
$$;

grant execute on function public.get_collections_with_previews(uuid) to authenticated, service_role, anon;
