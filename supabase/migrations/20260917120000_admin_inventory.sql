-- Admin inventory tool: hard-delete a product (its outfits cascade), hide or restore an outfit.

-- Screener FKs had no ON DELETE, so deleting a product they reference would fail.
alter table outfit_candidate_pairs
  drop constraint outfit_candidate_pairs_top_id_fkey,
  add constraint outfit_candidate_pairs_top_id_fkey
    foreign key (top_id) references products(id) on delete cascade,
  drop constraint outfit_candidate_pairs_bottom_id_fkey,
  add constraint outfit_candidate_pairs_bottom_id_fkey
    foreign key (bottom_id) references products(id) on delete cascade,
  drop constraint outfit_candidate_pairs_shoes_override_id_fkey,
  add constraint outfit_candidate_pairs_shoes_override_id_fkey
    foreign key (shoes_override_id) references products(id) on delete set null,
  drop constraint outfit_candidate_pairs_outfit_id_fkey,
  add constraint outfit_candidate_pairs_outfit_id_fkey
    foreign key (outfit_id) references outfits(id) on delete set null;

-- A theme keeps working with no chosen shoe; the reviewer picks another one.
alter table outfit_candidate_themes
  alter column chosen_shoes_id drop not null,
  drop constraint outfit_candidate_themes_chosen_shoes_id_fkey,
  add constraint outfit_candidate_themes_chosen_shoes_id_fkey
    foreign key (chosen_shoes_id) references products(id) on delete set null;

-- Set on "keep" so a reviewed outfit does not return to the queue.
alter table outfits add column reviewed_at timestamptz;

create table admin_removals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('product', 'outfit')),
  target_id text not null,
  target_name text,
  action text not null check (action in ('delete', 'hide', 'keep', 'restore')),
  outfit_count int,
  actor uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table admin_removals enable row level security;
create policy "admin read" on admin_removals for select
  using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));

create or replace function count_outfits_for_product(p_product_id text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not exists (select 1 from profiles where user_id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  select count(*) into v_count from outfits
    where top_id = p_product_id or bottom_id = p_product_id or shoes_id = p_product_id;
  return v_count;
end;
$$;

-- Deletes the product; outfits, favorites, images and candidate pairs cascade.
create or replace function delete_product(p_product_id text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_count int;
begin
  if not exists (select 1 from profiles where user_id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  select product_name into v_name from products where id = p_product_id for update;
  if not found then
    raise exception 'product % not found', p_product_id;
  end if;

  select count(*) into v_count from outfits
    where top_id = p_product_id or bottom_id = p_product_id or shoes_id = p_product_id;

  insert into admin_removals (kind, target_id, target_name, action, outfit_count, actor)
  values ('product', p_product_id, v_name, 'delete', v_count, auth.uid());

  delete from products where id = p_product_id;
  return v_count;
end;
$$;

create or replace function review_outfit(p_outfit_id text, p_decision text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if not exists (select 1 from profiles where user_id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;
  if p_decision not in ('keep', 'hide') then
    raise exception 'invalid decision: %', p_decision;
  end if;

  select name into v_name from outfits where id = p_outfit_id for update;
  if not found then
    raise exception 'outfit % not found', p_outfit_id;
  end if;

  update outfits
  set reviewed_at = now(),
      visible_in_feed = case when p_decision = 'hide' then false else visible_in_feed end
  where id = p_outfit_id;

  insert into admin_removals (kind, target_id, target_name, action, actor)
  values ('outfit', p_outfit_id, v_name, p_decision, auth.uid());
end;
$$;

create or replace function restore_outfit(p_outfit_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if not exists (select 1 from profiles where user_id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  select name into v_name from outfits where id = p_outfit_id for update;
  if not found then
    raise exception 'outfit % not found', p_outfit_id;
  end if;

  update outfits set visible_in_feed = true, reviewed_at = null where id = p_outfit_id;

  insert into admin_removals (kind, target_id, target_name, action, actor)
  values ('outfit', p_outfit_id, v_name, 'restore', auth.uid());
end;
$$;

revoke execute on function count_outfits_for_product(text) from public;
revoke execute on function delete_product(text) from public;
revoke execute on function review_outfit(text, text) from public;
revoke execute on function restore_outfit(text) from public;
grant execute on function count_outfits_for_product(text) to authenticated;
grant execute on function delete_product(text) to authenticated;
grant execute on function review_outfit(text, text) to authenticated;
grant execute on function restore_outfit(text) to authenticated;
