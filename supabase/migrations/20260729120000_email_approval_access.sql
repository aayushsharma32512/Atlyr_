-- Email-approval onboarding: access = the user's email is approved (invited/converted)
-- in the waitlist. Replaces the invite-code redemption gate. The OR-clause keeps any
-- existing invite-redemption users working during the transition.

create or replace function public.has_app_access()
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    exists (
      select 1
        from public.waitlist w
        join auth.users u on lower(u.email) = lower(w.email)
       where u.id = auth.uid()
         and w.status in ('invited', 'converted')
    )
    or exists (
      select 1 from public.invite_redemptions r where r.user_id = auth.uid()
    );
$$;

grant execute on function public.has_app_access() to authenticated;

-- Optional: flip an approved user's waitlist row to 'converted' on their first login
-- (analytics only — 'invited' already grants access). Called from AuthCallback.
create or replace function public.mark_self_converted()
returns void
language sql
security definer
set search_path = public
as $$
  update public.waitlist
     set status = 'converted', converted_at = now()
   where lower(email) = lower((select email from auth.users where id = auth.uid()))
     and status = 'invited';
$$;

grant execute on function public.mark_self_converted() to authenticated;
