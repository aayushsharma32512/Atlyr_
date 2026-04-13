-- Add phone number to waitlist submissions

alter table public.waitlist
  add column if not exists phone_number text;

drop function if exists public.submit_to_waitlist(text, text, text, jsonb);

create or replace function public.submit_to_waitlist(
  p_name text,
  p_email text,
  p_phone_number text,
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
  v_phone text := trim(p_phone_number);
begin
  if v_email is null or length(v_email) = 0 then
    return jsonb_build_object('success', false, 'error', 'EMAIL_REQUIRED');
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    return jsonb_build_object('success', false, 'error', 'NAME_REQUIRED');
  end if;

  if v_phone is null or length(v_phone) = 0 then
    return jsonb_build_object('success', false, 'error', 'PHONE_REQUIRED');
  end if;

  if exists (select 1 from public.waitlist where lower(email) = v_email) then
    return jsonb_build_object('success', false, 'error', 'ALREADY_REGISTERED');
  end if;

  insert into public.waitlist (name, email, phone_number, source, metadata)
  values (
    trim(p_name),
    v_email,
    v_phone,
    nullif(p_source, ''),
    coalesce(p_metadata, '{}'::jsonb)
  );

  return jsonb_build_object('success', true);
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'error', 'ALREADY_REGISTERED');
end;
$$;

grant execute on function public.submit_to_waitlist(text, text, text, text, jsonb) to anon, authenticated;
