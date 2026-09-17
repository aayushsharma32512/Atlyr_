-- Invite codes as a second front door next to email approval.
-- validate: accept any casing, and stop returning metadata (it holds the issuer's email).
-- redeem: same normalisation, and record the redeemer on the waitlist as converted so the
-- admin waitlist view lists everyone who has access.

set check_function_bodies = off;

create or replace function public.validate_invite_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invite_codes%rowtype;
begin
  select * into v_invite from public.invite_codes where code = upper(trim(p_code));

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

  return jsonb_build_object('valid', true, 'type', v_invite.type);
end;
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
  v_email text;
  v_name text;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into v_invite from public.invite_codes where code = upper(trim(p_code)) for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'INVITE_NOT_FOUND');
  end if;

  -- Idempotency wins: a user who already redeemed this code stays in, even if it has
  -- since expired or maxed out.
  if exists (
    select 1 from public.invite_redemptions
     where invite_code_id = v_invite.id and user_id = v_user_id
  ) then
    return jsonb_build_object('success', true, 'already_redeemed', true);
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

  insert into public.invite_redemptions (invite_code_id, code, user_id)
  values (v_invite.id, v_invite.code, v_user_id);

  update public.invite_codes
     set current_uses = v_invite.current_uses + 1, updated_at = now()
   where id = v_invite.id;

  select lower(u.email),
         coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), split_part(u.email, '@', 1))
    into v_email, v_name
    from auth.users u where u.id = v_user_id;

  if v_email is not null then
    insert into public.waitlist (name, email, status, source, converted_at, metadata)
    values (v_name, v_email, 'converted', 'invite_code', now(),
            jsonb_build_object('invite_code', v_invite.code))
    on conflict (lower(email)) do update
      set status = 'converted',
          converted_at = coalesce(public.waitlist.converted_at, now()),
          metadata = public.waitlist.metadata || excluded.metadata;
  end if;

  return jsonb_build_object('success', true);
exception
  when unique_violation then
    if exists (
      select 1 from public.invite_redemptions
       where invite_code_id = v_invite.id and user_id = v_user_id
    ) then
      return jsonb_build_object('success', true, 'already_redeemed', true);
    end if;
    return jsonb_build_object('success', false, 'error', 'INVITE_REDEMPTION_CONFLICT');
end;
$$;
