-- Fix: admin check used profiles.id instead of profiles.user_id, so it
-- matched no one. See outfit_enrichment_drafts for the correct pattern.

alter policy "admin read" on outfit_candidate_themes
  using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
alter policy "admin read" on outfit_candidate_pairs
  using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));

create or replace function set_theme_shoes(p_theme_id text, p_shoes_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from profiles where user_id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  update outfit_candidate_themes
  set chosen_shoes_id = p_shoes_id, chosen_by = auth.uid(), chosen_at = now()
  where theme_id = p_theme_id;
end;
$$;

create or replace function set_pair_shoes_override(p_candidate_id uuid, p_shoes_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from profiles where user_id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  update outfit_candidate_pairs
  set shoes_override_id = p_shoes_id
  where id = p_candidate_id and status = 'pending';
end;
$$;

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
  if not exists (select 1 from profiles where user_id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;
  if p_decision not in ('accepted', 'rejected') then
    raise exception 'invalid decision: %', p_decision;
  end if;

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
