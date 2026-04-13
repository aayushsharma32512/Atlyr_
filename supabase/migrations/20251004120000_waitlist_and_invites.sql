-- Waitlist and invite code infrastructure

set check_function_bodies = off;

do $$
begin
  create type public.waitlist_status as enum (
  'pending',
  'invited',
  'converted',
  'rejected'
  );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.invite_code_type as enum (
  'beta',
  'waitlist_invite',
  'special'
  );
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  status public.waitlist_status not null default 'pending',
  invite_code text unique,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  invited_at timestamptz,
  converted_at timestamptz
);

create unique index if not exists idx_waitlist_email_unique
  on public.waitlist (lower(email));

create table if not exists public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  type public.invite_code_type not null default 'beta',
  is_active boolean not null default true,
  max_uses integer,
  current_uses integer not null default 0,
  expires_at timestamptz,
  created_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_invite_codes_type
  on public.invite_codes (type);

create index if not exists idx_invite_codes_is_active
  on public.invite_codes (is_active);

alter table public.waitlist enable row level security;
alter table public.invite_codes enable row level security;

drop policy if exists "Waitlist anonymous insert" on public.waitlist;
create policy "Waitlist anonymous insert"
  on public.waitlist
  for insert
  with check (true);

drop policy if exists "Waitlist service select" on public.waitlist;
create policy "Waitlist service select"
  on public.waitlist
  for select
  using (auth.role() = 'service_role');

drop policy if exists "Invite codes service select" on public.invite_codes;
create policy "Invite codes service select"
  on public.invite_codes
  for select
  using (auth.role() = 'service_role');

drop policy if exists "Invite codes service insert" on public.invite_codes;
create policy "Invite codes service insert"
  on public.invite_codes
  for insert
  with check (auth.role() = 'service_role');

drop policy if exists "Invite codes service update" on public.invite_codes;
create policy "Invite codes service update"
  on public.invite_codes
  for update
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Invite codes service delete" on public.invite_codes;
create policy "Invite codes service delete"
  on public.invite_codes
  for delete
  using (auth.role() = 'service_role');

create or replace function public.update_invite_codes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger update_invite_codes_updated_at
  before update on public.invite_codes
  for each row
  execute function public.update_invite_codes_updated_at();

create or replace function public.validate_invite_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invite_codes%rowtype;
begin
  select *
    into v_invite
  from public.invite_codes
  where code = p_code;

  if not found then
    return jsonb_build_object('valid', false, 'error', 'INVITE_NOT_FOUND');
  end if;

  if not v_invite.is_active then
    return jsonb_build_object('valid', false, 'error', 'INVITE_INACTIVE');
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    return jsonb_build_object('valid', false, 'error', 'INVITE_EXPIRED');
  end if;

  if v_invite.max_uses is not null and v_invite.current_uses >= v_invite.max_uses then
    return jsonb_build_object('valid', false, 'error', 'INVITE_MAXED_OUT');
  end if;

  return jsonb_build_object(
    'valid', true,
    'type', v_invite.type,
    'metadata', coalesce(v_invite.metadata, '{}'::jsonb)
  );
end;
$$;

create or replace function public.record_invite_use(p_code text, p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invite_codes%rowtype;
begin
  select *
    into v_invite
  from public.invite_codes
  where code = p_code
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'INVITE_NOT_FOUND');
  end if;

  if v_invite.max_uses is not null and v_invite.current_uses >= v_invite.max_uses then
    return jsonb_build_object('success', false, 'error', 'INVITE_MAXED_OUT');
  end if;

  update public.invite_codes
     set current_uses = v_invite.current_uses + 1,
         updated_at = now()
   where id = v_invite.id;

  if v_invite.type = 'waitlist_invite' then
    update public.waitlist
       set status = 'converted',
           converted_at = now()
     where invite_code = p_code;
  end if;

  return jsonb_build_object('success', true);
exception
  when others then
    return jsonb_build_object('success', false, 'error', SQLERRM);
end;
$$;

create or replace function public.submit_to_waitlist(
  p_name text,
  p_email text,
  p_source text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
begin
  if v_email is null or length(v_email) = 0 then
    return jsonb_build_object('success', false, 'error', 'EMAIL_REQUIRED');
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    return jsonb_build_object('success', false, 'error', 'NAME_REQUIRED');
  end if;

  if exists (select 1 from public.waitlist where lower(email) = v_email) then
    return jsonb_build_object('success', false, 'error', 'ALREADY_REGISTERED');
  end if;

  insert into public.waitlist (name, email, source, metadata)
  values (
    trim(p_name),
    v_email,
    nullif(p_source, ''),
    coalesce(p_metadata, '{}'::jsonb)
  );

  return jsonb_build_object('success', true);
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'error', 'ALREADY_REGISTERED');
end;
$$;

grant execute on function public.validate_invite_code(text) to anon, authenticated;
grant execute on function public.record_invite_use(text, uuid) to authenticated;
grant execute on function public.submit_to_waitlist(text, text, text, jsonb) to anon, authenticated;

insert into public.invite_codes (code, type, is_active, max_uses)
values ('BETA_2024', 'beta', true, null)
on conflict (code) do nothing;


