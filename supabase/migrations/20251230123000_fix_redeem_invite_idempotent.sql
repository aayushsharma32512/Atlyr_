-- Fix redeem_invite to be idempotent for the original redeemer even after max_uses is reached.

set check_function_bodies = off;

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

  -- Idempotency must win: if the current user already redeemed this code, treat as success
  -- even if max_uses has since been reached or the invite has expired.
  if exists (
    select 1
      from public.invite_redemptions
     where invite_code_id = v_invite.id
       and user_id = v_user_id
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

