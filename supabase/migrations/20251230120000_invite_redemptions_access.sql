-- Invite redemption records + minimal access gating helpers

set check_function_bodies = off;

create table if not exists public.invite_redemptions (
  id uuid primary key default gen_random_uuid(),
  invite_code_id uuid not null references public.invite_codes(id) on delete cascade,
  code text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (invite_code_id, user_id)
);

create index if not exists idx_invite_redemptions_user_id
  on public.invite_redemptions (user_id);

create index if not exists idx_invite_redemptions_code
  on public.invite_redemptions (code);

alter table public.invite_redemptions enable row level security;

drop policy if exists "Invite redemptions owner select" on public.invite_redemptions;
create policy "Invite redemptions owner select"
  on public.invite_redemptions
  for select
  using (auth.uid() = user_id);

drop policy if exists "Invite redemptions service select" on public.invite_redemptions;
create policy "Invite redemptions service select"
  on public.invite_redemptions
  for select
  using (auth.role() = 'service_role');

create or replace function public.has_app_access()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.invite_redemptions
     where user_id = auth.uid()
  );
$$;

create or replace function public.redeem_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invite_codes%rowtype;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
  end if;

  select *
    into v_invite
  from public.invite_codes
  where code = p_code
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'INVITE_NOT_FOUND');
  end if;

  if not v_invite.is_active then
    return jsonb_build_object('success', false, 'error', 'INVITE_INACTIVE');
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    return jsonb_build_object('success', false, 'error', 'INVITE_EXPIRED');
  end if;

  if v_invite.max_uses is not null and v_invite.current_uses >= v_invite.max_uses then
    return jsonb_build_object('success', false, 'error', 'INVITE_MAXED_OUT');
  end if;

  if exists (
    select 1
      from public.invite_redemptions
     where invite_code_id = v_invite.id
       and user_id = v_user_id
  ) then
    return jsonb_build_object('success', true, 'already_redeemed', true);
  end if;

  insert into public.invite_redemptions (invite_code_id, code, user_id)
  values (v_invite.id, v_invite.code, v_user_id);

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
  when unique_violation then
    -- Idempotency: if we raced and another insert landed for this user+code, treat as success.
    if exists (
      select 1
        from public.invite_redemptions
       where invite_code_id = v_invite.id
         and user_id = v_user_id
    ) then
      return jsonb_build_object('success', true, 'already_redeemed', true);
    end if;
    return jsonb_build_object('success', false, 'error', 'INVITE_REDEMPTION_CONFLICT');
  when others then
    return jsonb_build_object('success', false, 'error', SQLERRM);
end;
$$;

grant execute on function public.has_app_access() to authenticated;
grant execute on function public.redeem_invite(text) to authenticated;

