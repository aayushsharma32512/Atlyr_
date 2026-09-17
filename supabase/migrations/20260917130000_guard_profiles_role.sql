-- profiles.role decides admin access (AdminAccessGuard, admin edge functions), but the
-- "update own profile" policy covers every column, so a user could set role = 'admin'.
-- Only the service role or a direct database session may change it.

create or replace function public.guard_profiles_role()
returns trigger
language plpgsql
as $$
declare
  v_changed boolean;
begin
  if tg_op = 'INSERT' then
    v_changed := new.role <> 'user';
  else
    v_changed := new.role is distinct from old.role;
  end if;
  -- auth.role() is null outside a request (dashboard, psql, auth triggers).
  if v_changed and coalesce(auth.role(), 'postgres') not in ('service_role', 'postgres') then
    raise exception 'role cannot be changed by the user' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profiles_role on public.profiles;
create trigger guard_profiles_role
  before insert or update of role on public.profiles
  for each row
  execute function public.guard_profiles_role();
