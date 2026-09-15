-- Outfit screener, phase 2: candidate review queue for admin accept/reject.
--
-- 19 new categories, one per theme ('streetwear' already exists and is reused as-is).
-- Two new tables: one footwear shortlist + one chosen default shoe per theme, and the
-- reviewable (top, bottom) pair queue. Every write to these tables, and every insert into
-- outfits from them, goes through the three functions below — the tables carry a read-only
-- policy for admins and no write policy at all, so a direct client insert/update is refused
-- by row level security even for an admin.

insert into categories (id, name, slug) values
  ('y2k', 'Y2K', 'y2k'),
  ('office-siren', 'Office Siren', 'office-siren'),
  ('coquette', 'Coquette', 'coquette'),
  ('boho-chic', 'Boho Chic', 'boho-chic'),
  ('clean-girl', 'Clean Girl', 'clean-girl'),
  ('minimalist', 'Minimalist', 'minimalist'),
  ('retro', 'Retro', 'retro'),
  ('cottagecore', 'Cottagecore', 'cottagecore'),
  ('grunge', 'Grunge', 'grunge'),
  ('athleisure', 'Athleisure', 'athleisure'),
  ('night-luxe', 'Night Luxe', 'night-luxe'),
  ('quiet-luxury', 'Quiet Luxury', 'quiet-luxury'),
  ('preppy', 'Preppy', 'preppy'),
  ('date-night', 'Date Night', 'date-night'),
  ('everyday-basics', 'Everyday Basics', 'everyday-basics'),
  ('summer-ready', 'Summer Ready', 'summer-ready'),
  ('resortwear', 'Resortwear', 'resortwear'),
  ('loungewear', 'Loungewear', 'loungewear'),
  ('statement-piece', 'Statement Piece', 'statement-piece');

create table outfit_candidate_themes (
  theme_id text primary key,
  theme_name text not null,
  category_id text not null references categories(id),
  footwear_options jsonb not null,
  chosen_shoes_id text not null references products(id),
  chosen_by uuid references auth.users(id),
  chosen_at timestamptz
);

create table outfit_candidate_pairs (
  id uuid primary key default gen_random_uuid(),
  theme_id text not null references outfit_candidate_themes(theme_id),
  pair_rank int not null,
  top_id text not null references products(id),
  bottom_id text not null references products(id),
  sim_pair real not null,
  shoes_override_id text references products(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  outfit_id text references outfits(id),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (theme_id, top_id, bottom_id)
);

-- the review page's main query: this theme's pending pairs, best score first
create index outfit_candidate_pairs_queue_idx
  on outfit_candidate_pairs (theme_id, status, pair_rank);

alter table outfit_candidate_themes enable row level security;
alter table outfit_candidate_pairs enable row level security;

create policy "admin read" on outfit_candidate_themes for select
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
create policy "admin read" on outfit_candidate_pairs for select
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- change a theme's default shoe; every outfit in the theme without its own override follows
create or replace function set_theme_shoes(p_theme_id text, p_shoes_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  update outfit_candidate_themes
  set chosen_shoes_id = p_shoes_id, chosen_by = auth.uid(), chosen_at = now()
  where theme_id = p_theme_id;
end;
$$;

-- override the shoe for one pending pair only; pass null to clear back to the theme default
create or replace function set_pair_shoes_override(p_candidate_id uuid, p_shoes_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  update outfit_candidate_pairs
  set shoes_override_id = p_shoes_id
  where id = p_candidate_id and status = 'pending';
end;
$$;

-- accept or reject one pair. accept writes outfits and the candidate row in one transaction.
create or replace function decide_outfit_candidate(p_candidate_id uuid, p_decision text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair outfit_candidate_pairs%rowtype;
  v_theme outfit_candidate_themes%rowtype;
  v_shoes_id text;
  v_outfit_id text;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;
  if p_decision not in ('accepted', 'rejected') then
    raise exception 'invalid decision: %', p_decision;
  end if;

  -- "for update" locks this row for the rest of the transaction, so two reviewers deciding
  -- the same candidate at the same instant cannot both pass the "is it still pending" check
  select * into v_pair from outfit_candidate_pairs
    where id = p_candidate_id and status = 'pending'
    for update;
  if not found then
    raise exception 'candidate % is not pending', p_candidate_id;
  end if;

  if p_decision = 'rejected' then
    update outfit_candidate_pairs
    set status = 'rejected', decided_by = auth.uid(), decided_at = now()
    where id = p_candidate_id;
    return null;
  end if;

  select * into v_theme from outfit_candidate_themes where theme_id = v_pair.theme_id;
  v_shoes_id := coalesce(v_pair.shoes_override_id, v_theme.chosen_shoes_id);
  v_outfit_id := gen_random_uuid()::text;

  insert into outfits (id, name, category, occasion, top_id, bottom_id, shoes_id,
                        is_private, created_by, gender)
  values (v_outfit_id, v_theme.theme_name || ' #' || v_pair.pair_rank,
          v_theme.category_id, 'others', v_pair.top_id, v_pair.bottom_id, v_shoes_id,
          false, 'ATLYR', 'female');

  update outfit_candidate_pairs
  set status = 'accepted', outfit_id = v_outfit_id, decided_by = auth.uid(), decided_at = now()
  where id = p_candidate_id;

  return v_outfit_id;
end;
$$;

revoke all on function set_theme_shoes(text, text) from public;
revoke all on function set_pair_shoes_override(uuid, text) from public;
revoke all on function decide_outfit_candidate(uuid, text) from public;
grant execute on function set_theme_shoes(text, text) to authenticated;
grant execute on function set_pair_shoes_override(uuid, text) to authenticated;
grant execute on function decide_outfit_candidate(uuid, text) to authenticated;
